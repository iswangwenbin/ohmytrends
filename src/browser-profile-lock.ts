import { lstatSync, readlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const PROFILE_LOCK_FILES = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
  "DevToolsActivePort",
];

export type BrowserProfileLock = {
  lockPath: string;
  pid?: number;
  stale: boolean;
};

export async function preparePersistentProfile(profileDir: string): Promise<void> {
  const lock = inspectPersistentProfileLock(profileDir);
  if (!lock) return;
  if (!lock.stale) {
    const pidPart = typeof lock.pid === "number" ? ` PID ${lock.pid}` : "";
    throw new Error(
      `Browser profile is already in use:${pidPart} (${profileDir}). Close the existing browser/session or wait for the previous query to finish.`,
    );
  }
  await clearPersistentProfileLock(profileDir);
}

export function inspectPersistentProfileLock(profileDir: string): BrowserProfileLock | undefined {
  const lockPath = join(profileDir, "SingletonLock");
  if (!pathExists(lockPath)) return undefined;
  const pid = readProfileLockPid(lockPath);
  return {
    lockPath,
    pid,
    stale: typeof pid === "number" ? !isProcessRunning(pid) : true,
  };
}

async function clearPersistentProfileLock(profileDir: string): Promise<void> {
  await Promise.all(PROFILE_LOCK_FILES.map((file) => rm(join(profileDir, file), { force: true })));
}

function readProfileLockPid(lockPath: string): number | undefined {
  const raw = readProfileLockTarget(lockPath);
  const match = raw.match(/-(\d+)$/);
  if (!match) return undefined;
  const pid = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(pid) ? pid : undefined;
}

function readProfileLockTarget(lockPath: string): string {
  try {
    const stat = lstatSync(lockPath);
    if (stat.isSymbolicLink()) return readlinkSync(lockPath);
  } catch {
    // Fall through to readlink; Chromium lock files are usually symlinks.
  }
  try {
    return readlinkSync(lockPath);
  } catch {
    return "";
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}
