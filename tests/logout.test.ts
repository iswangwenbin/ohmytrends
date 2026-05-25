import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeProfileDir, logoutProfiles, logoutTargets, normalizeLogoutArgs } from "../src/logout.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("logout command helpers", () => {
  test("resolves default logout targets like login", () => {
    expect(logoutTargets([])).toEqual([
      { source: "baidu", profileDir: "profiles/baidu" },
      { source: "google", profileDir: "profiles/google" },
    ]);
  });

  test("resolves custom root profile targets", () => {
    expect(logoutTargets(["--profile-dir", "tmp/profiles"])).toEqual([
      { source: "baidu", profileDir: "tmp/profiles/baidu" },
      { source: "google", profileDir: "tmp/profiles/google" },
    ]);
  });

  test("resolves single source profile targets", () => {
    expect(logoutTargets(["--source", "google"])).toEqual([
      { source: "google", profileDir: "profiles/google" },
    ]);
  });

  test("supports positional logout targets", () => {
    expect(normalizeLogoutArgs(["google", "--profile-dir", "tmp/profile"])).toEqual([
      "--source",
      "google",
      "--profile-dir",
      "tmp/profile",
    ]);
    expect(logoutTargets(["google"])).toEqual([
      { source: "google", profileDir: "profiles/google" },
    ]);
  });

  test("rejects invalid positional logout targets", () => {
    expect(() => normalizeLogoutArgs(["bing"])).toThrow("Invalid logout target");
  });

  test("removes profile directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "ohmytrends-logout-"));
    tempDirs.push(root);
    mkdirSync(join(root, "baidu"), { recursive: true });
    mkdirSync(join(root, "google"), { recursive: true });

    const results = await logoutProfiles(["--profile-dir", root]);

    expect(results.map((item) => ({ source: item.source, removed: item.removed }))).toEqual([
      { source: "baidu", removed: true },
      { source: "google", removed: true },
    ]);
    expect(existsSync(join(root, "baidu"))).toBe(false);
    expect(existsSync(join(root, "google"))).toBe(false);
  });

  test("refuses unsafe profile directories", () => {
    expect(() => assertSafeProfileDir(process.cwd())).toThrow("Refusing to remove unsafe profile directory");
  });
});
