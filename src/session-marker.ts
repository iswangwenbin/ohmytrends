import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Source } from "./types.js";

const SESSION_MARKER_FILE = ".ohmytrends-session.json";

export type SessionMarker = {
  source: Source;
  status: "verified";
  verifiedAt: string;
  version: 1;
};

export function sessionMarkerPath(profileDir: string): string {
  return join(profileDir, SESSION_MARKER_FILE);
}

export function hasVerifiedSessionMarker(profileDir: string, source: Source): boolean {
  const marker = readSessionMarker(profileDir);
  return marker?.source === source && marker.status === "verified";
}

export function readSessionMarker(profileDir: string): SessionMarker | undefined {
  const path = sessionMarkerPath(profileDir);
  if (!existsSync(path)) return undefined;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<SessionMarker>;
    if (data.version !== 1 || data.status !== "verified") return undefined;
    if (data.source !== "baidu" && data.source !== "google") return undefined;
    if (typeof data.verifiedAt !== "string" || !data.verifiedAt) return undefined;
    return data as SessionMarker;
  } catch {
    return undefined;
  }
}

export async function markSessionVerified(profileDir: string, source: Source): Promise<void> {
  await mkdir(profileDir, { recursive: true });
  const marker: SessionMarker = {
    source,
    status: "verified",
    verifiedAt: new Date().toISOString(),
    version: 1,
  };
  await writeFile(sessionMarkerPath(profileDir), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

export async function clearSessionMarker(profileDir: string): Promise<void> {
  await rm(sessionMarkerPath(profileDir), { force: true });
}
