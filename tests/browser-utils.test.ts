import { describe, expect, test } from "bun:test";
import {
  assertLoginWindowOpen,
  hasOpenPages,
  isTargetClosedError,
  loginWindowClosedMessage,
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
});
