import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { parse, resolve } from "node:path";
import { readFlag, readOptions, withoutFlag } from "./options.js";
import type { Source } from "./types.js";

export type LogoutTarget = {
  source: Source;
  profileDir: string;
};

export type LogoutResult = LogoutTarget & {
  removed: boolean;
};

const SOURCES: Source[] = ["baidu", "google"];

export function logoutTargets(args: string[]): LogoutTarget[] {
  const normalizedArgs = normalizeLogoutArgs(args);
  const explicitSource = readFlag(normalizedArgs, "--source");
  if (!explicitSource) {
    return SOURCES.map((source) => {
      const options = readOptions(authArgsForSource(normalizedArgs, source));
      return { source, profileDir: options.profileDir };
    });
  }

  const options = readOptions(normalizedArgs);
  if (options.source === "all") {
    return SOURCES.map((source) => ({
      source,
      profileDir: `${options.profileDir}/${source}`,
    }));
  }

  return [{ source: options.source, profileDir: options.profileDir }];
}

export async function logoutProfiles(args: string[]): Promise<LogoutResult[]> {
  const targets = uniqueTargets(logoutTargets(args));
  const results: LogoutResult[] = [];

  for (const target of targets) {
    assertSafeProfileDir(target.profileDir);
    const removed = existsSync(target.profileDir);
    await rm(target.profileDir, { recursive: true, force: true });
    results.push({ ...target, removed });
  }

  return results;
}

export function normalizeLogoutArgs(args: string[]): string[] {
  const [first, ...rest] = args;
  if (!first || first.startsWith("--") || readFlag(args, "--source")) return args;
  if (first === "baidu" || first === "google" || first === "all") {
    return ["--source", first, ...rest];
  }
  throw new Error(`Invalid logout target: ${first}. Expected baidu, google, or all`);
}

export function assertSafeProfileDir(profileDir: string): void {
  const resolved = resolve(profileDir);
  const root = parse(resolved).root;
  const unsafePaths = new Set([
    root,
    resolve(process.cwd()),
    process.env.HOME ? resolve(process.env.HOME) : undefined,
  ].filter(Boolean));

  if (unsafePaths.has(resolved)) {
    throw new Error(`Refusing to remove unsafe profile directory: ${profileDir}`);
  }
}

function authArgsForSource(args: string[], source: Source): string[] {
  const profileRoot = readFlag(args, "--profile-dir");
  const sharedArgs = profileRoot ? withoutFlag(args, "--profile-dir") : args;
  const sourceArgs = [...sharedArgs, "--source", source];
  if (profileRoot) sourceArgs.push("--profile-dir", `${profileRoot}/${source}`);
  return sourceArgs;
}

function uniqueTargets(targets: LogoutTarget[]): LogoutTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.source}:${resolve(target.profileDir)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
