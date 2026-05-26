import { describe, expect, test } from "bun:test";
import {
  assertBrowserSessionAlive,
  assertLoginWindowOpen,
  browserBridgeSnapshot,
  hasOpenPages,
  installBrowserSessionBridge,
  isTargetClosedError,
  loginWindowClosedMessage,
  setBaiduLoginGuide,
} from "../src/browser-utils.js";
import type { BrowserContextLike, PageLike } from "../src/types.js";

describe("browser close handling", () => {
  test("detects Playwright target closed errors", () => {
    expect(isTargetClosedError(new Error("Target page, context or browser has been closed"))).toBe(true);
    expect(isTargetClosedError(new Error("Target closed"))).toBe(true);
    expect(isTargetClosedError(new Error("Timeout 30000ms exceeded"))).toBe(false);
  });

  test("treats closed or missing pages as no active login window", () => {
    const closedPage = { isClosed: () => true } as PageLike;
    const context = {
      pages: () => [closedPage],
    } as BrowserContextLike;

    expect(hasOpenPages(context)).toBe(false);
    expect(() => assertLoginWindowOpen(context, closedPage, "百度")).toThrow(loginWindowClosedMessage("百度"));
  });

  test("handles contexts that already closed", () => {
    const page = { isClosed: () => false } as PageLike;
    const context = {
      pages: () => {
        throw new Error("Browser has been closed");
      },
    } as unknown as BrowserContextLike;

    expect(hasOpenPages(context)).toBe(false);
    expect(() => assertLoginWindowOpen(context, page, "Google")).toThrow(loginWindowClosedMessage("Google"));
  });

  test("injects and toggles the Baidu login guide", async () => {
    const calls: Array<{ type: string; arg: unknown }> = [];
    const page = {
      addInitScript: async (_callback: (...args: any[]) => any, arg?: unknown) => {
        calls.push({ type: "init", arg });
      },
      evaluate: async (_callback: (...args: any[]) => any, arg?: unknown) => {
        calls.push({ type: "evaluate", arg });
      },
    } as unknown as PageLike;

    await setBaiduLoginGuide(page, true, "点击右上角登录");
    await setBaiduLoginGuide(page, false);

    expect(calls).toContainEqual({ type: "init", arg: "请点击右上角“登录”按钮完成百度登录。" });
    expect(calls).toContainEqual({
      type: "evaluate",
      arg: { visible: true, message: "点击右上角登录" },
    });
    expect(calls).toContainEqual({
      type: "evaluate",
      arg: { visible: false, message: "请点击右上角“登录”按钮完成百度登录。" },
    });
  });

  test("tracks browser heartbeat events from the page bridge", async () => {
    let binding:
      | ((source: { page?: PageLike }, payload?: unknown) => unknown | Promise<unknown>)
      | undefined;
    const page = {
      url: () => "about:blank",
      isClosed: () => false,
      on: () => undefined,
      addInitScript: async () => undefined,
      evaluate: async () => undefined,
    } as unknown as PageLike;
    const context = {
      pages: () => [page],
      addInitScript: async () => undefined,
      exposeBinding: async (_name, callback) => {
        binding = callback;
      },
      on: () => undefined,
    } as unknown as BrowserContextLike;

    await installBrowserSessionBridge(context, { heartbeatIntervalMs: 1_000 });
    await binding?.({ page }, {
      type: "heartbeat",
      url: "https://accounts.google.com/",
      title: "Sign in",
    });

    const snapshot = browserBridgeSnapshot(context);
    expect(snapshot?.openPages).toBe(1);
    expect(snapshot?.lastPageUrl).toBe("https://accounts.google.com/");
    expect(snapshot?.lastPageTitle).toBe("Sign in");
    expect(() => assertBrowserSessionAlive(context, "Google")).not.toThrow();
  });
});
