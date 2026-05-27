import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasBaiduLoginInProfile } from "../src/baidu.js";
import { hasGoogleLoginInProfile } from "../src/google.js";
import {
  clearSessionMarker,
  hasVerifiedSessionMarker,
  markSessionVerified,
  readSessionMarker,
} from "../src/session-marker.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("session marker", () => {
  test("marks and reads a verified source session", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "ohmytrends-session-"));
    tempDirs.push(profileDir);

    await markSessionVerified(profileDir, "baidu");

    expect(hasVerifiedSessionMarker(profileDir, "baidu")).toBe(true);
    expect(hasVerifiedSessionMarker(profileDir, "google")).toBe(false);
    expect(hasBaiduLoginInProfile(profileDir)).toBe(true);
    expect(hasGoogleLoginInProfile(profileDir)).toBe(false);
    expect(readSessionMarker(profileDir)?.source).toBe("baidu");
  });

  test("clears a verified source session", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "ohmytrends-session-"));
    tempDirs.push(profileDir);

    await markSessionVerified(profileDir, "google");
    await clearSessionMarker(profileDir);

    expect(hasVerifiedSessionMarker(profileDir, "google")).toBe(false);
    expect(readSessionMarker(profileDir)).toBeUndefined();
  });
});
