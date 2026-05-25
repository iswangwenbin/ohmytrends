import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserRoots,
  importableSources,
  importBrowserSession,
  type BrowserProfileCandidate,
} from "../src/session-import.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("browser session import", () => {
  test("returns importable sources from detected login state", () => {
    expect(importableSources(candidate({ hasBaidu: true, hasGoogle: false }))).toEqual(["baidu"]);
    expect(importableSources(candidate({ hasBaidu: false, hasGoogle: true }))).toEqual(["google"]);
    expect(importableSources(candidate({ hasBaidu: true, hasGoogle: true }))).toEqual(["baidu", "google"]);
  });

  test("includes Comet browser roots", () => {
    expect(browserRoots().some((root) => root.browser === "Comet")).toBe(true);
  });

  test("copies selected session files into ohmytrends profile shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "ohmytrends-import-source-"));
    const target = await mkdtemp(join(tmpdir(), "ohmytrends-import-target-"));
    tempDirs.push(root, target);
    const profileDir = join(root, "Default");
    mkdirSync(join(profileDir, "Network"), { recursive: true });
    mkdirSync(join(profileDir, "Local Storage"), { recursive: true });
    writeFileSync(join(root, "Local State"), "{}");
    writeFileSync(join(profileDir, "Network/Cookies"), "cookies");
    writeFileSync(join(profileDir, "Preferences"), "{}");

    const result = await importBrowserSession({
      source: "google",
      targetProfileDir: target,
      candidate: {
        browser: "Chrome",
        profileName: "Default",
        profileDir,
        rootDir: root,
        hasBaidu: false,
        hasGoogle: true,
      },
    });

    expect(result.copied).toContain("Local State");
    expect(result.copied).toContain("Network/Cookies");
    expect(existsSync(join(target, "Local State"))).toBe(true);
    expect(existsSync(join(target, "Default/Network/Cookies"))).toBe(true);
    expect(existsSync(join(target, "Default/Preferences"))).toBe(true);
  });
});

function candidate(overrides: Partial<BrowserProfileCandidate>): BrowserProfileCandidate {
  return {
    browser: "Chrome",
    profileName: "Default",
    profileDir: "/tmp/chrome/Default",
    rootDir: "/tmp/chrome",
    hasBaidu: false,
    hasGoogle: false,
    ...overrides,
  };
}
