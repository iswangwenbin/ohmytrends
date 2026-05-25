import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { runtimeInfo } from "./logger.js";
import type { BrowserContextLike, PageLike, ResponseLike } from "./types.js";

const contextStatuses = new WeakMap<BrowserContextLike, string>();
const installedContexts = new WeakSet<BrowserContextLike>();
const keptOpenContexts = new Set<BrowserContextLike>();
let keepOpenSignalsInstalled = false;

export async function installContextStatusOverlay(
  context: BrowserContextLike,
  visible: boolean,
  initialStatus: string,
): Promise<void> {
  if (!visible || installedContexts.has(context)) return;
  installedContexts.add(context);
  contextStatuses.set(context, initialStatus);

  await context.addInitScript?.(installStatusOverlayScript, initialStatus).catch(() => undefined);
  context.on?.("page", async (page) => {
    await setPageStatus(page, true, contextStatuses.get(context) || initialStatus);
  });
  await setContextStatus(context, true, initialStatus);
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

async function ensureStatusInitScript(page: PageLike): Promise<void> {
  await page.addInitScript(installStatusOverlayScript, "准备启动采集任务...");
}

function installStatusOverlayScript(initialStatus: string): void {
  class OhmytrendsStatusOverlay {
    id = "ohmytrends-status";
    styleId = `${this.id}-style`;

    mount() {
      this.ensureStyle();
      let node = document.getElementById(this.id);
      if (!node) {
        node = document.createElement("div");
        node.id = this.id;
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
        node.innerHTML = `
          <div class="ohmytrends-status__badge">运行中</div>
          <div class="ohmytrends-status__body">
            <div class="ohmytrends-status__title">ohmytrends</div>
            <div class="ohmytrends-status__text"></div>
          </div>
        `;
        document.documentElement.appendChild(node);
      }
      return node;
    }

    render(text: string) {
      const node = this.mount();
      const state = this.statusState(text);
      node.dataset.ohmytrendsState = state;
      const badge = node.querySelector(".ohmytrends-status__badge");
      if (badge) {
        badge.textContent = state === "done" ? "已完成" : state === "error" ? "需处理" : "运行中";
      }
      const label = node.querySelector(".ohmytrends-status__text");
      if (label) label.textContent = text;
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
          right: 18px !important;
          bottom: 76px !important;
          z-index: 2147483647 !important;
          display: grid !important;
          grid-template-columns: auto minmax(0, 1fr) !important;
          gap: 12px !important;
          align-items: center !important;
          max-width: min(520px, calc(100vw - 36px)) !important;
          min-width: min(360px, calc(100vw - 36px)) !important;
          padding: 14px 16px !important;
          border: 2px solid rgba(243, 211, 21, .92) !important;
          border-radius: 10px !important;
          background: linear-gradient(135deg, #325211 0%, #3f6f12 52%, #468012 100%) !important;
          box-shadow: 0 0 0 4px rgba(243, 211, 21, .22), 0 18px 46px rgba(0, 0, 0, .35) !important;
          color: #ffffff !important;
          font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
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
          min-width: 62px !important;
          height: 34px !important;
          padding: 0 12px !important;
          border-radius: 999px !important;
          border: 2px solid rgba(255, 255, 255, .92) !important;
          background: #f3d315 !important;
          color: #1f2a0e !important;
          font-size: 12px !important;
          font-weight: 800 !important;
          box-shadow: 0 6px 16px rgba(31, 42, 14, .28), inset 0 -2px 0 rgba(31, 42, 14, .14) !important;
        }
        #${this.id}[data-ohmytrends-state="done"] {
          animation: none !important;
          box-shadow: 0 0 0 4px rgba(243, 211, 21, .18), 0 18px 46px rgba(0, 0, 0, .32) !important;
        }
        #${this.id}[data-ohmytrends-state="done"] .ohmytrends-status__badge {
          background: #ecfccb !important;
          color: #325211 !important;
          border-color: rgba(255, 255, 255, .96) !important;
        }
        #${this.id}[data-ohmytrends-state="error"] .ohmytrends-status__badge {
          background: #f97316 !important;
          color: #ffffff !important;
          border-color: rgba(255, 255, 255, .92) !important;
        }
        #${this.id} .ohmytrends-status__body {
          min-width: 0 !important;
        }
        #${this.id} .ohmytrends-status__title {
          margin-bottom: 2px !important;
          color: #f3d315 !important;
          font-size: 13px !important;
          font-weight: 800 !important;
        }
        #${this.id} .ohmytrends-status__text {
          color: #ffffff !important;
          font-size: 16px !important;
          font-weight: 700 !important;
        }
        @keyframes ohmytrends-status-pulse {
          0%, 100% {
            transform: translateY(0) !important;
            box-shadow: 0 0 0 4px rgba(243, 211, 21, .22), 0 18px 46px rgba(0, 0, 0, .35) !important;
          }
          50% {
            transform: translateY(-2px) !important;
            box-shadow: 0 0 0 9px rgba(243, 211, 21, .16), 0 22px 56px rgba(0, 0, 0, .42) !important;
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
  runtimeInfo([
    message,
    "浏览器窗口会继续保留。",
    "按 Ctrl+C 可关闭保留的浏览器并退出。",
  ].join("\n"));
}

export async function closeKeptOpenContexts(): Promise<void> {
  const contexts = [...keptOpenContexts];
  keptOpenContexts.clear();
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
