import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { inspectPersistentProfileLock, preparePersistentProfile } from "../src/browser-profile-lock.js";

describe("browser profile locks", () => {
  test("reports active persistent profile locks with the owning pid", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "ohmytrends-profile-lock-"));
    await symlink(`host-${process.pid}`, join(profileDir, "SingletonLock"));

    const lock = inspectPersistentProfileLock(profileDir);
    expect(lock?.pid).toBe(process.pid);
    expect(lock?.stale).toBe(false);
    await expect(preparePersistentProfile(profileDir)).rejects.toThrow(`PID ${process.pid}`);
  });

  test("clears stale persistent profile locks before launch", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "ohmytrends-profile-lock-"));
    await symlink("host-99999999", join(profileDir, "SingletonLock"));
    await symlink("socket", join(profileDir, "SingletonSocket"));
    await symlink("cookie", join(profileDir, "SingletonCookie"));
    await writeFile(join(profileDir, "DevToolsActivePort"), "1234\n", "utf8");

    const lock = inspectPersistentProfileLock(profileDir);
    expect(lock?.pid).toBe(99999999);
    expect(lock?.stale).toBe(true);

    await preparePersistentProfile(profileDir);

    expect(existsSync(join(profileDir, "SingletonLock"))).toBe(false);
    expect(existsSync(join(profileDir, "SingletonSocket"))).toBe(false);
    expect(existsSync(join(profileDir, "SingletonCookie"))).toBe(false);
    expect(existsSync(join(profileDir, "DevToolsActivePort"))).toBe(false);
  });
});
