import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hasCookieInProfile } from "./browser-utils.js";
import { DEFAULT_BAIDU_PROFILE_DIR, DEFAULT_GOOGLE_PROFILE_DIR } from "./config.js";
import type { Source } from "./types.js";

export type BrowserProfileCandidate = {
  browser: string;
  profileName: string;
  profileDir: string;
  rootDir: string;
  hasBaidu: boolean;
  hasGoogle: boolean;
};

export type ImportSessionOptions = {
  source: Source;
  candidate: BrowserProfileCandidate;
  targetProfileDir?: string;
};

export type ImportSessionResult = {
  source: Source;
  browser: string;
  profileName: string;
  targetProfileDir: string;
  copied: string[];
};

const chromiumProfileNames = ["Default", "Profile 1", "Profile 2", "Profile 3", "Profile 4", "Profile 5"];
const copiedEntries = [
  "Cookies",
  "Network/Cookies",
  "Local Storage",
  "Session Storage",
  "IndexedDB",
  "WebStorage",
  "Preferences",
];

export async function scanBrowserProfiles(): Promise<BrowserProfileCandidate[]> {
  const roots = browserRoots();
  const candidates: BrowserProfileCandidate[] = [];
  for (const root of roots) {
    for (const profileName of chromiumProfileNames) {
      const profileDir = join(root.rootDir, profileName);
      if (!existsSync(profileDir)) continue;
      const candidate = {
        browser: root.browser,
        profileName,
        profileDir,
        rootDir: root.rootDir,
        hasBaidu: hasCookieInProfile(profileDir, ["BDUSS", "BDUSS_BFESS"]),
        hasGoogle: hasCookieInProfile(profileDir, [
          "SID",
          "HSID",
          "SSID",
          "APISID",
          "SAPISID",
          "__Secure-1PSID",
          "__Secure-3PSID",
        ]),
      };
      if (candidate.hasBaidu || candidate.hasGoogle) candidates.push(candidate);
    }
  }
  return candidates;
}

export async function importBrowserSession(options: ImportSessionOptions): Promise<ImportSessionResult> {
  const targetProfileDir = options.targetProfileDir || defaultTargetProfileDir(options.source);
  const copied: string[] = [];
  await mkdir(targetProfileDir, { recursive: true });

  const localState = join(options.candidate.rootDir, "Local State");
  if (existsSync(localState)) {
    await copyEntry(localState, join(targetProfileDir, "Local State"));
    copied.push("Local State");
  }

  const targetDefaultDir = join(targetProfileDir, "Default");
  await mkdir(targetDefaultDir, { recursive: true });
  for (const entry of copiedEntries) {
    const source = join(options.candidate.profileDir, entry);
    if (!existsSync(source)) continue;
    await copyEntry(source, join(targetDefaultDir, entry));
    copied.push(entry);
  }

  return {
    source: options.source,
    browser: options.candidate.browser,
    profileName: options.candidate.profileName,
    targetProfileDir,
    copied,
  };
}

export function importableSources(candidate: BrowserProfileCandidate): Source[] {
  const sources: Source[] = [];
  if (candidate.hasBaidu) sources.push("baidu");
  if (candidate.hasGoogle) sources.push("google");
  return sources;
}

export function browserRoots(): { browser: string; rootDir: string }[] {
  const home = process.env.HOME;
  if (!home) return [];
  if (process.platform === "darwin") {
    return [
      { browser: "Chrome", rootDir: join(home, "Library/Application Support/Google/Chrome") },
      { browser: "Chrome Canary", rootDir: join(home, "Library/Application Support/Google/Chrome Canary") },
      { browser: "Edge", rootDir: join(home, "Library/Application Support/Microsoft Edge") },
      { browser: "Arc", rootDir: join(home, "Library/Application Support/Arc/User Data") },
      { browser: "Comet", rootDir: join(home, "Library/Application Support/Comet") },
      { browser: "Comet", rootDir: join(home, "Library/Application Support/Comet/User Data") },
      { browser: "Brave", rootDir: join(home, "Library/Application Support/BraveSoftware/Brave-Browser") },
    ];
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (!local) return [];
    return [
      { browser: "Chrome", rootDir: join(local, "Google/Chrome/User Data") },
      { browser: "Edge", rootDir: join(local, "Microsoft/Edge/User Data") },
      { browser: "Comet", rootDir: join(local, "Comet/User Data") },
      { browser: "Brave", rootDir: join(local, "BraveSoftware/Brave-Browser/User Data") },
    ];
  }
  return [
    { browser: "Chrome", rootDir: join(home, ".config/google-chrome") },
    { browser: "Chromium", rootDir: join(home, ".config/chromium") },
    { browser: "Edge", rootDir: join(home, ".config/microsoft-edge") },
    { browser: "Comet", rootDir: join(home, ".config/comet") },
    { browser: "Brave", rootDir: join(home, ".config/BraveSoftware/Brave-Browser") },
  ];
}

function defaultTargetProfileDir(source: Source): string {
  return source === "google" ? DEFAULT_GOOGLE_PROFILE_DIR : DEFAULT_BAIDU_PROFILE_DIR;
}

async function copyEntry(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(resolve(source), resolve(target), {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}
