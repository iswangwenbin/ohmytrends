import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import floatingCoreUmd from "./generated/floating-ui.core.umd.min.js" with { type: "text" };
import floatingDomUmd from "./generated/floating-ui.dom.umd.min.js" with { type: "text" };
import { runtimeInfo } from "./logger.js";
import type { BrowserContextLike, PageLike, ResponseLike } from "./types.js";

const contextStatuses = new WeakMap<BrowserContextLike, string>();
const installedContexts = new WeakSet<BrowserContextLike>();
const keptOpenContexts = new Set<BrowserContextLike>();
const browserBridgeStates = new WeakMap<BrowserContextLike, BrowserSessionState>();
const installedBrowserBridgeContexts = new WeakSet<BrowserContextLike>();
const bridgedPages = new WeakSet<PageLike>();
let keepOpenSignalsInstalled = false;
let keepOpenKeepAliveTimer: ReturnType<typeof setInterval> | undefined;
const DEFAULT_BROWSER_HEARTBEAT_INTERVAL_MS = 2_500;
const DEFAULT_BROWSER_HEARTBEAT_MAX_AGE_MS = 20_000;
const DEFAULT_BAIDU_LOGIN_GUIDE_MESSAGE = "请点击右上角“登录”按钮完成百度登录。";
const FLOATING_UI_BUNDLE = `${floatingCoreUmd}\n;${floatingDomUmd}`;

export type BrowserSessionState = {
  startedAt: number;
  lastEventAt: number;
  lastHeartbeatAt?: number;
  lastPageUrl?: string;
  lastPageTitle?: string;
  openPages: number;
  closedPages: number;
  crashedPages: number;
  contextClosed: boolean;
  errors: string[];
};

type BrowserSessionEvent = {
  type?: string;
  url?: string;
  title?: string;
  message?: string;
  at?: number;
};

type BrowserSessionBridgeOptions = {
  heartbeatIntervalMs?: number;
};

type BrowserSessionAliveOptions = {
  maxHeartbeatAgeMs?: number;
};

export async function installContextStatusOverlay(
  context: BrowserContextLike,
  visible: boolean,
  initialStatus: string,
): Promise<void> {
  if (!visible) return;
  await installBrowserSessionBridge(context).catch(() => undefined);
  if (installedContexts.has(context)) return;
  installedContexts.add(context);
  contextStatuses.set(context, initialStatus);

  await context.addInitScript?.(installStatusOverlayScript, initialStatus).catch(() => undefined);
  await context.addInitScript?.(injectFloatingUiBundle, FLOATING_UI_BUNDLE).catch(() => undefined);
  await context.addInitScript?.(installBaiduLoginGuideScript, DEFAULT_BAIDU_LOGIN_GUIDE_MESSAGE).catch(() => undefined);
  context.on?.("page", async (page) => {
    await setPageStatus(page, true, contextStatuses.get(context) || initialStatus);
  });
  await setContextStatus(context, true, initialStatus);
}

export async function installBrowserSessionBridge(
  context: BrowserContextLike,
  options: BrowserSessionBridgeOptions = {},
): Promise<void> {
  if (installedBrowserBridgeContexts.has(context)) return;
  installedBrowserBridgeContexts.add(context);
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_BROWSER_HEARTBEAT_INTERVAL_MS;
  const state = ensureBrowserBridgeState(context);
  refreshBrowserBridgeOpenPages(context, state);

  await context.exposeBinding?.("__ohmytrendsBrowserEvent", (source, payload) => {
    recordBrowserBridgeEvent(context, source?.page, normalizeBrowserBridgeEvent(payload));
  }).catch(() => undefined);
  await context.addInitScript?.(installBrowserHeartbeatScript, heartbeatIntervalMs).catch(() => undefined);

  context.on?.("page", async (page: PageLike) => {
    await attachBrowserBridgePage(context, page, heartbeatIntervalMs);
  });
  context.on?.("close", () => {
    const current = ensureBrowserBridgeState(context);
    current.contextClosed = true;
    current.lastEventAt = Date.now();
    current.openPages = 0;
  });

  await Promise.all(safeContextPages(context).map((page) => attachBrowserBridgePage(context, page, heartbeatIntervalMs)));
}

export function browserBridgeSnapshot(context: BrowserContextLike): BrowserSessionState | undefined {
  const state = browserBridgeStates.get(context);
  if (!state) return undefined;
  refreshBrowserBridgeOpenPages(context, state);
  return { ...state, errors: [...state.errors] };
}

export function assertBrowserSessionAlive(
  context: BrowserContextLike,
  service: string,
  options: BrowserSessionAliveOptions = {},
): void {
  const state = browserBridgeStates.get(context);
  if (state) refreshBrowserBridgeOpenPages(context, state);
  if (state?.contextClosed || !hasOpenPages(context)) {
    throw new Error(loginWindowClosedMessage(service));
  }

  const maxHeartbeatAgeMs = options.maxHeartbeatAgeMs ?? DEFAULT_BROWSER_HEARTBEAT_MAX_AGE_MS;
  if (!state?.lastHeartbeatAt) return;
  const now = Date.now();
  const heartbeatAge = now - state.lastHeartbeatAt;
  const eventAge = now - state.lastEventAt;
  if (heartbeatAge > maxHeartbeatAgeMs && eventAge > maxHeartbeatAgeMs) {
    throw new Error(loginWindowClosedMessage(service));
  }
}

async function attachBrowserBridgePage(
  context: BrowserContextLike,
  page: PageLike,
  heartbeatIntervalMs: number,
): Promise<void> {
  if (bridgedPages.has(page)) return;
  bridgedPages.add(page);
  recordBrowserBridgeEvent(context, page, { type: "page", url: safePageUrl(page) });
  page.on?.("close", () => recordBrowserBridgeEvent(context, page, { type: "close", url: safePageUrl(page) }));
  page.on?.("crash", () => recordBrowserBridgeEvent(context, page, { type: "crash", url: safePageUrl(page) }));
  page.on?.("framenavigated", () => recordBrowserBridgeEvent(context, page, { type: "navigate", url: safePageUrl(page) }));
  await page.addInitScript(installBrowserHeartbeatScript, heartbeatIntervalMs).catch(() => undefined);
  await page.evaluate(installBrowserHeartbeatScript, heartbeatIntervalMs).catch(() => undefined);
}

function ensureBrowserBridgeState(context: BrowserContextLike): BrowserSessionState {
  const existing = browserBridgeStates.get(context);
  if (existing) return existing;
  const now = Date.now();
  const state: BrowserSessionState = {
    startedAt: now,
    lastEventAt: now,
    openPages: 0,
    closedPages: 0,
    crashedPages: 0,
    contextClosed: false,
    errors: [],
  };
  browserBridgeStates.set(context, state);
  return state;
}

function recordBrowserBridgeEvent(
  context: BrowserContextLike,
  page: PageLike | undefined,
  event: BrowserSessionEvent,
): void {
  const state = ensureBrowserBridgeState(context);
  const now = Date.now();
  state.lastEventAt = now;
  if (event.type === "heartbeat" || event.type === "ready" || event.type === "visibility") {
    state.lastHeartbeatAt = now;
  }
  const url = event.url || (page ? safePageUrl(page) : "");
  if (url) state.lastPageUrl = url;
  if (event.title) state.lastPageTitle = event.title;
  if (event.message) state.errors = [...state.errors.slice(-9), event.message];
  if (event.type === "close") state.closedPages += 1;
  if (event.type === "crash") state.crashedPages += 1;
  refreshBrowserBridgeOpenPages(context, state);
}

function refreshBrowserBridgeOpenPages(context: BrowserContextLike, state: BrowserSessionState): void {
  try {
    state.openPages = context.pages().filter((page) => !isPageClosed(page)).length;
    state.contextClosed = false;
  } catch (error) {
    state.openPages = 0;
    state.contextClosed = true;
    const message = error instanceof Error ? error.message : String(error);
    state.errors = [...state.errors.slice(-9), message];
  }
}

function normalizeBrowserBridgeEvent(payload: unknown): BrowserSessionEvent {
  if (!payload || typeof payload !== "object") return {};
  const event = payload as Record<string, unknown>;
  return {
    type: typeof event.type === "string" ? event.type : undefined,
    url: typeof event.url === "string" ? event.url : undefined,
    title: typeof event.title === "string" ? event.title : undefined,
    message: typeof event.message === "string" ? event.message : undefined,
    at: typeof event.at === "number" ? event.at : undefined,
  };
}

function safeContextPages(context: BrowserContextLike): PageLike[] {
  try {
    return context.pages();
  } catch {
    return [];
  }
}

function safePageUrl(page: PageLike): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function installBrowserHeartbeatScript(intervalMs: number): void {
  const global = window as typeof window & {
    __ohmytrendsBrowserHeartbeatInstalled?: boolean;
    __ohmytrendsBrowserEvent?: (payload: BrowserSessionEvent) => Promise<void> | void;
  };
  if (global.__ohmytrendsBrowserHeartbeatInstalled) return;
  global.__ohmytrendsBrowserHeartbeatInstalled = true;

  const emit = (type: string, message?: string) => {
    try {
      void global.__ohmytrendsBrowserEvent?.({
        type,
        url: window.location.href,
        title: document.title,
        message,
        at: Date.now(),
      });
    } catch {
      // Heartbeat is best-effort. The CLI also listens to page lifecycle events.
    }
  };

  emit("ready");
  window.setInterval(() => emit("heartbeat"), Math.max(1_000, intervalMs));
  window.addEventListener("beforeunload", () => emit("beforeunload"));
  window.addEventListener("pagehide", () => emit("pagehide"));
  document.addEventListener("visibilitychange", () => emit("visibility"));
  window.addEventListener("error", (event) => emit("error", event.message));
}

export async function setContextStatus(
  context: BrowserContextLike,
  visible: boolean,
  status: string,
): Promise<void> {
  if (!visible) return;
  contextStatuses.set(context, status);
  let pages: PageLike[];
  try {
    pages = context.pages();
  } catch {
    return;
  }
  await Promise.all(pages.map((page) => setPageStatus(page, true, status)));
}

export async function setPageStatus(page: PageLike, visible: boolean, status: string): Promise<void> {
  if (!visible) return;
  try {
    await ensureStatusInitScript(page);
    await page.evaluate((text) => {
      window.__ohmytrendsSetStatus?.(text);
    }, status);
  } catch {
    // Status overlay is best-effort UI feedback for visible browser sessions.
  }
}

export async function setBaiduLoginGuide(
  page: PageLike,
  visible: boolean,
  message = DEFAULT_BAIDU_LOGIN_GUIDE_MESSAGE,
): Promise<void> {
  try {
    await ensureBaiduLoginGuideInitScript(page);
    await page.evaluate(({ visible: shouldShow, message: text }) => {
      if (shouldShow) {
        window.__ohmytrendsShowBaiduLoginGuide?.(text);
      } else {
        window.__ohmytrendsHideBaiduLoginGuide?.();
      }
    }, { visible, message });
  } catch {
    // Login guidance is best-effort UI feedback for visible browser sessions.
  }
}

async function ensureStatusInitScript(page: PageLike): Promise<void> {
  await page.addInitScript(installStatusOverlayScript, "准备启动采集任务...").catch(() => undefined);
  await page.evaluate(installStatusOverlayScript, "准备启动采集任务...").catch(() => undefined);
}

async function ensureBaiduLoginGuideInitScript(page: PageLike): Promise<void> {
  await page.addInitScript(installBaiduLoginGuideScript, DEFAULT_BAIDU_LOGIN_GUIDE_MESSAGE).catch(() => undefined);
  await page.addInitScript(injectFloatingUiBundle, FLOATING_UI_BUNDLE).catch(() => undefined);
  await page.evaluate(injectFloatingUiBundle, FLOATING_UI_BUNDLE).catch(() => undefined);
  await page.evaluate(installBaiduLoginGuideScript, DEFAULT_BAIDU_LOGIN_GUIDE_MESSAGE).catch(() => undefined);
}

function injectFloatingUiBundle(source: string): void {
  const w = window as typeof window & { FloatingUIDOM?: { computePosition?: unknown } };
  if (w.FloatingUIDOM?.computePosition) return;
  try {
    new Function(source).call(window);
  } catch {
    // Best-effort: positioning will fall back to manual placement if injection fails.
  }
}

function installStatusOverlayScript(initialStatus: string): void {
  class OhmytrendsStatusOverlay {
    id = "ohmytrends-status";
    styleId = `${this.id}-style`;
    positionBound = false;

    mount() {
      this.ensureStyle();
      let node = document.getElementById(this.id);
      if (!node) {
        node = document.createElement("div");
        node.id = this.id;
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
        node.innerHTML = `
          <div class="ohmytrends-status__badge">…</div>
          <div class="ohmytrends-status__body">
            <div class="ohmytrends-status__brand">OHMYTRENDS</div>
            <div class="ohmytrends-status__title"></div>
            <div class="ohmytrends-status__chips"></div>
          </div>
        `;
        document.documentElement.appendChild(node);
      }
      this.bindPosition();
      return node;
    }

    render(text: string) {
      const node = this.mount();
      const state = this.statusState(text);
      node.dataset.ohmytrendsState = state;
      const badge = node.querySelector(".ohmytrends-status__badge");
      if (badge) {
        badge.textContent = state === "done" ? "✓" : state === "error" ? "!" : "…";
      }
      const summary = this.parseStatus(text);
      const title = node.querySelector(".ohmytrends-status__title");
      if (title) title.textContent = summary.title;
      const chips = node.querySelector(".ohmytrends-status__chips");
      if (chips) chips.innerHTML = summary.chips.map((chip) => `<span>${chip}</span>`).join("");
      this.position(node);
      window.requestAnimationFrame(() => this.position(node));
    }

    parseStatus(text: string) {
      const normalized = text.trim();
      const title = normalized.replace(/[。.]$/, "").replace(/[：:].*$/, "");
      const chips: string[] = [];
      const trend = normalized.match(/趋势点\s*(\d+)/);
      const related = normalized.match(/相关查询\s*(\d+)/);
      const search = normalized.match(/search\s*(\d+)/i);
      const feed = normalized.match(/feed\s*(\d+)/i);
      if (trend) chips.push(`🔥 趋势点 ${trend[1]}`);
      if (related) chips.push(`🔎 查询 ${related[1]}`);
      if (!trend && search) chips.push(`🔥 搜索 ${search[1]}`);
      if (!related && feed) chips.push(`📰 资讯 ${feed[1]}`);
      return {
        title,
        chips,
      };
    }

    bindPosition() {
      if (this.positionBound) return;
      this.positionBound = true;
      const update = () => {
        const node = document.getElementById(this.id);
        if (node) this.position(node);
      };
      window.addEventListener("resize", update, { passive: true });
      window.visualViewport?.addEventListener("resize", update, { passive: true });
      window.visualViewport?.addEventListener("scroll", update, { passive: true });
      document.addEventListener("scroll", update, { passive: true, capture: true });
    }

    position(node: HTMLElement) {
      const margin = 12;
      node.style.setProperty("top", `${margin}px`, "important");
      node.style.setProperty("left", "50%", "important");
      node.style.setProperty("right", "auto", "important");
      node.style.setProperty("bottom", "auto", "important");
      node.style.setProperty("transform", "translateX(-50%)", "important");
    }

    statusState(text: string) {
      if (/完成|已完成|结束|成功|就绪/.test(text)) return "done";
      if (/失败|错误|超时|未收录|异常|需|请登录/.test(text)) return "error";
      return "running";
    }

    ensureStyle() {
      if (document.getElementById(this.styleId)) return;
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
        #${this.id} {
          position: fixed !important;
          top: 12px !important;
          left: 50% !important;
          right: auto !important;
          bottom: auto !important;
          transform: translateX(-50%) !important;
          z-index: 2147483647 !important;
          display: grid !important;
          box-sizing: border-box !important;
          grid-template-columns: auto minmax(0, 1fr) !important;
          gap: 10px !important;
          align-items: center !important;
          width: min(280px, calc(100vw - 32px)) !important;
          max-width: min(280px, calc(100vw - 32px)) !important;
          min-width: min(280px, calc(100vw - 32px)) !important;
          max-height: calc(100vh - 32px) !important;
          min-height: 60px !important;
          padding: 10px 14px 10px 46px !important;
          border: 2px solid #10b981 !important;
          border-radius: 12px !important;
          background: rgba(255, 255, 255, .96) !important;
          box-shadow: 3px 3px 0 #10b981, 0 8px 20px rgba(15, 23, 42, .12) !important;
          color: #0f172a !important;
          font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
          letter-spacing: 0 !important;
          pointer-events: none !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
          animation: ohmytrends-status-pulse 1.6s ease-in-out infinite !important;
        }
        #${this.id} .ohmytrends-status__badge {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          position: absolute !important;
          left: -18px !important;
          top: 50% !important;
          width: 44px !important;
          height: 44px !important;
          padding: 0 !important;
          border-radius: 999px !important;
          border: 3px solid rgba(255, 255, 255, .96) !important;
          background: #f97316 !important;
          color: #ffffff !important;
          font-size: 20px !important;
          font-weight: 800 !important;
          line-height: 1 !important;
          transform: translateY(-50%) !important;
          box-shadow: 0 6px 12px rgba(124, 45, 18, .16), inset 0 -2px 0 rgba(124, 45, 18, .14) !important;
        }
        #${this.id}[data-ohmytrends-state="done"] {
          animation: none !important;
          border-color: #16a34a !important;
          box-shadow: 3px 3px 0 #10b981, 0 8px 20px rgba(15, 23, 42, .12) !important;
        }
        #${this.id}[data-ohmytrends-state="done"] .ohmytrends-status__badge {
          background: #16a34a !important;
          color: #ffffff !important;
          border-color: rgba(255, 255, 255, .96) !important;
        }
        #${this.id}[data-ohmytrends-state="done"] .ohmytrends-status__title {
          color: #15803d !important;
        }
        #${this.id}[data-ohmytrends-state="error"] {
          border-color: #f97316 !important;
          box-shadow: 3px 3px 0 #f97316, 0 8px 20px rgba(124, 45, 18, .12) !important;
        }
        #${this.id}[data-ohmytrends-state="error"] .ohmytrends-status__badge {
          background: #fb923c !important;
          color: #ffffff !important;
          border-color: rgba(255, 255, 255, .92) !important;
        }
        #${this.id}[data-ohmytrends-state="error"] .ohmytrends-status__title {
          color: #b91c1c !important;
        }
        #${this.id} .ohmytrends-status__body {
          min-width: 0 !important;
          max-height: calc(100vh - 64px) !important;
          overflow: hidden !important;
        }
        #${this.id} .ohmytrends-status__brand {
          margin-bottom: 2px !important;
          color: #10b981 !important;
          font-size: 10px !important;
          font-weight: 900 !important;
          letter-spacing: .12em !important;
        }
        #${this.id} .ohmytrends-status__title {
          margin-bottom: 6px !important;
          color: #0f172a !important;
          font-size: 13px !important;
          font-weight: 800 !important;
          line-height: 1.3 !important;
          overflow-wrap: anywhere !important;
        }
        #${this.id} .ohmytrends-status__chips {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 6px !important;
        }
        #${this.id} .ohmytrends-status__chips span {
          display: inline-flex !important;
          align-items: center !important;
          height: 20px !important;
          padding: 0 8px !important;
          border: 1px solid rgba(16, 185, 129, .38) !important;
          border-radius: 999px !important;
          background: #ecfdf5 !important;
          color: #047857 !important;
          font-size: 10px !important;
          font-weight: 800 !important;
        }
        @keyframes ohmytrends-status-pulse {
          0%, 100% {
            box-shadow: 3px 3px 0 #f97316, 0 8px 20px rgba(124, 45, 18, .12) !important;
          }
          50% {
            box-shadow: 3px 3px 0 #fb923c, 0 10px 24px rgba(124, 45, 18, .14) !important;
          }
        }
      `;
      document.documentElement.appendChild(style);
    }
  }

  const overlay = window.__ohmytrendsStatusOverlay || new OhmytrendsStatusOverlay();
  window.__ohmytrendsStatusOverlay = overlay;
  const render = (text: string) => overlay.render(text);

  window.__ohmytrendsSetStatus = render;
  if (document.documentElement) render(initialStatus);
  document.addEventListener("DOMContentLoaded", () => render(initialStatus), { once: true });
}

function installBaiduLoginGuideScript(defaultMessage: string): void {
  type BaiduLoginGuideState = {
    initialized?: boolean;
    cleanup?: () => void;
    lastMessage?: string;
  };

  const global = window as typeof window & {
    __ohmytrendsBaiduLoginGuide?: BaiduLoginGuideState;
  };

  if (global.__ohmytrendsBaiduLoginGuide?.initialized) return;

  const state: BaiduLoginGuideState = global.__ohmytrendsBaiduLoginGuide = {
    initialized: true,
    lastMessage: defaultMessage,
  };
  const id = "ohmytrends-baidu-login-guide";
  const arrowId = `${id}-arrow`;
  const styleId = `${id}-style`;
  const anchorId = `${id}-anchor`;

  const ensureStyle = () => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #${id} {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        z-index: 2147483647 !important;
        box-sizing: border-box !important;
        display: grid !important;
        grid-template-columns: auto minmax(0, 1fr) !important;
        gap: 16px !important;
        align-items: center !important;
        width: min(420px, calc(100vw - 48px)) !important;
        min-height: 92px !important;
        padding: 18px 22px 18px 78px !important;
        border: 3px solid #f97316 !important;
        border-radius: 18px !important;
        background: rgba(255, 255, 255, .96) !important;
        color: #431407 !important;
        box-shadow: 5px 5px 0 #f97316, 0 14px 30px rgba(124, 45, 18, .14) !important;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
        letter-spacing: 0 !important;
        pointer-events: none !important;
        opacity: 0 !important;
        transform-origin: top right !important;
        transition: opacity .16s ease, transform .16s ease !important;
      }
      #${id}[data-visible="true"] {
        opacity: 1 !important;
      }
      #${id} .ohmytrends-login-guide__badge {
        position: absolute !important;
        left: -28px !important;
        top: 50% !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 70px !important;
        height: 70px !important;
        border-radius: 999px !important;
        border: 5px solid rgba(255, 255, 255, .96) !important;
        background: #fb923c !important;
        color: #ffffff !important;
        font-size: 34px !important;
        font-weight: 900 !important;
        line-height: 1 !important;
        transform: translateY(-50%) !important;
        box-shadow: 0 10px 18px rgba(124, 45, 18, .16), inset 0 -3px 0 rgba(124, 45, 18, .14) !important;
      }
      #${id} .ohmytrends-login-guide__body {
        min-width: 0 !important;
      }
      #${id} .ohmytrends-login-guide__title {
        margin: 0 0 6px !important;
        color: #ea580c !important;
        font-size: 14px !important;
        font-weight: 900 !important;
        letter-spacing: .08em !important;
      }
      #${id} .ohmytrends-login-guide__text {
        margin: 0 !important;
        color: #111827 !important;
        font-size: 18px !important;
        font-weight: 900 !important;
        overflow-wrap: anywhere !important;
      }
      #${arrowId} {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        z-index: 2147483646 !important;
        width: 96px !important;
        height: 94px !important;
        color: #f97316 !important;
        filter: drop-shadow(0 8px 14px rgba(124, 45, 18, .22)) !important;
        pointer-events: none !important;
        transform-origin: center !important;
        opacity: 0 !important;
        transition: opacity .16s ease, transform .16s ease !important;
      }
      #${arrowId}[data-visible="true"] {
        opacity: 1 !important;
      }
      #${arrowId} svg {
        display: block !important;
        width: 100% !important;
        height: 100% !important;
      }
      #${anchorId} {
        position: fixed !important;
        right: 96px !important;
        top: 22px !important;
        width: 52px !important;
        height: 30px !important;
        pointer-events: none !important;
        opacity: 0 !important;
      }
    `;
    document.documentElement.appendChild(style);
  };

  const mount = () => {
    ensureStyle();
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement("div");
      node.id = id;
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.innerHTML = `
        <div class="ohmytrends-login-guide__badge">!</div>
        <div class="ohmytrends-login-guide__body">
          <div class="ohmytrends-login-guide__title">百度登录</div>
          <p class="ohmytrends-login-guide__text"></p>
        </div>
      `;
      document.documentElement.appendChild(node);
    }
    let arrow = document.getElementById(arrowId);
    if (!arrow) {
      arrow = document.createElement("div");
      arrow.id = arrowId;
      arrow.innerHTML = `
        <svg width="144" height="141" viewBox="0 0 144 141" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M129.189 0.0490494C128.744 0.119441 126.422 0.377545 124.03 0.635648C114.719 1.6446 109.23 2.4893 108.058 3.09936C107.119 3.56864 106.674 4.34295 106.674 5.44576C106.674 6.71281 107.424 7.51058 109.043 7.97986C110.403 8.37875 110.825 8.42567 118.87 9.52847C121.778 9.92736 124.288 10.3028 124.475 10.3732C124.663 10.4436 122.951 11.1006 120.676 11.8749C110.028 15.4414 100.412 20.7677 91.7339 27.9242C88.38 30.7164 81.6957 37.4271 79.2096 40.5009C73.8387 47.2116 69.6874 54.8139 66.5681 63.7302C65.9348 65.4665 65.3484 66.8978 65.2546 66.8978C65.1374 66.8978 63.7771 66.7336 62.2291 66.5693C52.9649 65.5134 43.1847 68.1649 34.1316 74.2186C24.7735 80.46 18.5349 87.7338 10.5371 101.742C2.53943 115.726 -1.0959 127.482 0.287874 135.014C0.89767 138.463 2.0469 140.035 3.97011 140.082C5.28352 140.105 5.37733 139.659 4.20465 139.049C3.05541 138.463 2.6567 137.9 2.32835 136.281C0.616228 128.021 6.24512 113.028 17.4325 96.1104C23.2725 87.241 28.362 81.9147 35.5622 77.1046C43.8649 71.5437 52.7069 69.033 61.1737 69.8308C64.9967 70.1828 64.6917 69.9247 64.1992 72.4822C62.2525 82.5013 63.8005 92.6378 67.9753 97.354C73.1116 103.079 81.9771 102 85.0027 95.2657C86.3395 92.2858 86.3864 87.7103 85.1434 83.9796C83.1498 78.0901 80.007 73.8197 75.4335 70.8163C73.8152 69.7604 70.4848 68.1883 69.875 68.1883C69.359 68.1883 69.4294 67.6487 70.2268 65.3257C72.3377 59.2486 75.457 52.7021 78.4122 48.244C83.2436 40.9232 91.4524 32.5701 99.1687 27.103C105.806 22.4102 113.241 18.5386 120.512 16.0045C123.772 14.8548 129.87 13.1889 130.081 13.3766C130.128 13.447 129.541 14.362 128.791 15.4414C124.78 21.0258 122.716 26.0706 122.388 30.998C122.224 33.7198 122.341 34.588 122.88 34.2595C122.998 34.1891 123.678 32.969 124.405 31.5611C126.281 27.8069 131.722 20.6738 139.579 11.6402C141.127 9.85697 142.652 7.86254 143.027 7.08823C144.552 4.03792 143.52 1.48035 140.377 0.471397C139.439 0.166366 138.102 0.0490408 134.584 0.0255769C132.074 -0.021351 129.635 0.00212153 129.189 0.0490494ZM137.117 4.92955C137.187 5.0234 136.718 5.63346 136.061 6.29045L134.865 7.48712L131.042 6.73627C128.931 6.33739 126.727 5.9385 126.14 5.8681C124.827 5.68039 124.123 5.32843 124.968 5.28151C125.296 5.28151 126.868 5.11725 128.486 4.953C131.3 4.64797 136.812 4.62451 137.117 4.92955ZM71.5168 72.5292C76.2075 74.899 79.4441 78.8175 81.3204 84.355C83.6189 91.1361 81.2266 96.8378 76.0433 96.8847C73.3227 96.9082 70.9773 95.2188 69.5936 92.2389C68.2802 89.4232 67.6938 86.5606 67.5765 82.1259C67.4593 78.3248 67.6 76.4242 68.2333 72.7403L68.4912 71.2856L69.359 71.5906C69.8515 71.7548 70.8132 72.1772 71.5168 72.5292Z" fill="currentColor"/>
        </svg>
      `;
      document.documentElement.appendChild(arrow);
    }
    let anchor = document.getElementById(anchorId);
    if (!anchor) {
      anchor = document.createElement("div");
      anchor.id = anchorId;
      document.documentElement.appendChild(anchor);
    }
    return node as HTMLElement;
  };

  const visibleRect = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    if (rect.right <= 0 || rect.bottom <= 0) return null;
    if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return null;
    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return null;
    return rect;
  };

  const directText = (element: Element): string => {
    let direct = "";
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 3) direct += child.textContent || "";
    }
    direct = direct.replace(/\s+/g, " ").trim();
    if (direct) return direct;
    return (element.textContent || "").replace(/\s+/g, " ").trim();
  };

  const ensureAnchor = (): HTMLElement => {
    let anchor = document.getElementById(anchorId);
    if (!anchor) {
      mount();
      anchor = document.getElementById(anchorId);
    }
    return anchor as HTMLElement;
  };

  const LOGIN_RE = /^(?:登录|登陆|登录\/注册|登录\s*\/\s*注册|登入|Login|Sign\s*in|Log\s*in)$/i;

  const findLoginTarget = (): Element | { getBoundingClientRect(): DOMRect } => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a, span, div, li, p, [role='button'], [class*='login' i], [class*='Login' i], [class*='passport' i]",
      ),
    );
    let best: { element: Element; score: number } | undefined;
    for (const element of candidates) {
      if ((element as HTMLElement).closest(`#${id}`)) continue;
      const rect = visibleRect(element);
      if (!rect) continue;
      if (rect.width > 240 || rect.height > 80) continue;
      if (rect.top > 200) continue;
      const text = directText(element);
      if (!text || text.length > 10) continue;
      if (!LOGIN_RE.test(text)) continue;
      const rightDistance = Math.max(0, window.innerWidth - rect.right);
      const areaPenalty = (rect.width * rect.height) / 80;
      const tagName = element.tagName.toLowerCase();
      const tagPenalty = tagName === "span" ? -80 : tagName === "a" || tagName === "button" ? -40 : 0;
      const exactTextPenalty = text === "登录" || /^login$/i.test(text) ? -40 : 0;
      const score = rightDistance + rect.top * 0.2 + areaPenalty + tagPenalty + exactTextPenalty;
      if (!best || score < best.score) best = { element, score };
    }
    if (best) return best.element;
    return ensureAnchor();
  };

  const placeArrow = (
    arrowEl: HTMLElement,
    target: Element | { getBoundingClientRect(): DOMRect },
  ) => {
    const targetRect = target.getBoundingClientRect();
    const arrowWidth = arrowEl.offsetWidth || 96;
    const arrowHeight = arrowEl.offsetHeight || 94;
    const headX = targetRect.left + targetRect.width / 2;
    const headY = targetRect.bottom + 6;
    const left = Math.max(8, Math.min(window.innerWidth - arrowWidth - 8, headX - arrowWidth * 0.98));
    const top = Math.max(8, Math.min(window.innerHeight - arrowHeight - 8, headY));

    arrowEl.style.setProperty("left", `${Math.round(left)}px`, "important");
    arrowEl.style.setProperty("top", `${Math.round(top)}px`, "important");
    arrowEl.style.setProperty("right", "", "important");
    arrowEl.style.setProperty("bottom", "", "important");
    arrowEl.style.setProperty("transform", "rotate(0deg)", "important");
  };

  const placeGuide = (target: Element | { getBoundingClientRect(): DOMRect }, floating: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const width = floating.offsetWidth;
    const height = floating.offsetHeight;
    const targetCenterX = rect.left + rect.width / 2;
    const x = Math.max(12, Math.min(window.innerWidth - width - 12, targetCenterX - width / 2));
    const y = Math.max(12, Math.min(window.innerHeight - height - 12, rect.bottom + 118));
    floating.style.setProperty("left", `${x}px`, "important");
    floating.style.setProperty("top", `${y}px`, "important");
    floating.style.setProperty("transform", "translateY(0)", "important");
  };

  const updatePosition = async () => {
    const floating = document.getElementById(id) as HTMLElement | null;
    if (!floating || floating.dataset.visible !== "true") return;
    const arrowEl = document.getElementById(arrowId) as HTMLElement | null;
    const target = findLoginTarget();
    placeGuide(target, floating);
    if (arrowEl) {
      arrowEl.dataset.visible = "true";
      placeArrow(arrowEl, target);
    }
  };

  const bindAutoUpdate = () => {
    state.cleanup?.();
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(() => updatePosition());
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const onUpdate = () => updatePosition();
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    const timer = window.setInterval(onUpdate, 800);
    state.cleanup = () => {
      observer.disconnect();
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, true);
      window.clearInterval(timer);
    };
  };

  global.__ohmytrendsShowBaiduLoginGuide = (message?: string) => {
    state.lastMessage = message || defaultMessage;
    const node = mount();
    const text = node.querySelector(".ohmytrends-login-guide__text");
    if (text) text.textContent = state.lastMessage;
    node.dataset.visible = "true";
    bindAutoUpdate();
    window.requestAnimationFrame(() => updatePosition());
  };

  global.__ohmytrendsHideBaiduLoginGuide = () => {
    const node = document.getElementById(id);
    if (node) node.dataset.visible = "false";
    const arrow = document.getElementById(arrowId);
    if (arrow) arrow.dataset.visible = "false";
    state.cleanup?.();
    state.cleanup = undefined;
  };
}

export async function waitForPageSettled(page: PageLike): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
  } catch {
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  }
}

export async function waitUntilInterrupted(message: string): Promise<void> {
  runtimeInfo([
    message,
    "按 Ctrl+C 可关闭保留的浏览器并退出。",
  ].join("\n"));
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export function keepContextOpenUntilExit(context: BrowserContextLike, message: string): void {
  keptOpenContexts.add(context);
  installKeepOpenSignalHandlers();
  keepOpenKeepAliveTimer ??= setInterval(() => undefined, 60_000);
  runtimeInfo([
    message,
    "浏览器窗口会继续保留。",
    "按 Ctrl+C 可关闭保留的浏览器并退出。",
  ].join("\n"));
}

export async function closeKeptOpenContexts(): Promise<void> {
  const contexts = [...keptOpenContexts];
  keptOpenContexts.clear();
  if (keepOpenKeepAliveTimer) {
    clearInterval(keepOpenKeepAliveTimer);
    keepOpenKeepAliveTimer = undefined;
  }
  await Promise.all(contexts.map((context) => closeContextSafely(context)));
}

function installKeepOpenSignalHandlers(): void {
  if (keepOpenSignalsInstalled) return;
  keepOpenSignalsInstalled = true;
  const close = () => {
    void closeKeptOpenContexts().finally(() => {
      process.exit(0);
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

export async function closeContextSafely(context: BrowserContextLike): Promise<void> {
  await context.close().catch(() => undefined);
}

export function isPageClosed(page: PageLike): boolean {
  return Boolean(page.isClosed?.());
}

export function hasOpenPages(context: BrowserContextLike): boolean {
  try {
    return context.pages().some((page) => !isPageClosed(page));
  } catch {
    return false;
  }
}

export function isTargetClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed|Target closed|Browser has been closed|Page closed|Context closed|Session closed|Connection closed/i
    .test(message);
}

export function loginWindowClosedMessage(service: string): string {
  return `${service} 登录窗口已关闭；请重新发起登录或采集请求。`;
}

export function assertLoginWindowOpen(
  context: BrowserContextLike,
  page: PageLike,
  service: string,
): void {
  if (isPageClosed(page) || !hasOpenPages(context)) {
    throw new Error(loginWindowClosedMessage(service));
  }
}

export async function evaluateWithNavigationRetry<Arg, Result>(
  page: PageLike,
  callback: (arg: Arg) => Result | Promise<Result>,
  arg: Arg,
): Promise<Result> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await waitForPageSettled(page);
      return await page.evaluate(callback as never, arg);
    } catch (error) {
      lastError = error;
      if (!isNavigationContextError(error)) throw error;
      await page.waitForTimeout(1_000);
    }
  }

  throw lastError;
}

export async function readJsonResponse<T>(response: ResponseLike): Promise<T | undefined> {
  try {
    return await response.json() as T;
  } catch {
    return undefined;
  }
}

export function hasCookieInProfile(profileDir: string, names: string[]): boolean {
  const candidates = [
    `${profileDir}/Default/Cookies`,
    `${profileDir}/Default/Network/Cookies`,
    `${profileDir}/Cookies`,
    `${profileDir}/Network/Cookies`,
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const db = new Database(path, { readonly: true });
      try {
        const placeholders = names.map(() => "?").join(",");
        const row = db.query(`select 1 as found from cookies where name in (${placeholders}) limit 1`).get(...names) as {
          found?: number;
        } | null;
        if (row?.found) return true;
      } finally {
        db.close();
      }
    } catch {
      continue;
    }
  }
  return false;
}

function isNavigationContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Cannot find context|navigation/i.test(message);
}
