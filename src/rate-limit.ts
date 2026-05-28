import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeDiagnostics } from "./diagnostics.js";
import { runtimeInfo } from "./logger.js";
import type { CollectOutput, Options, Source } from "./types.js";

const RATE_LIMIT_STATE_FILE = ".ohmytrends-rate-limit.json";
const RATE_LIMIT_TEXT_RE = /疑似存在异常访问行为|访问频次过高|exceed speed limit|speed limit/i;

export type RateLimitState = {
  source: Source;
  lastAttemptAt?: string;
  cooldownUntil?: string;
  reason?: string;
  version: 1;
};

export async function waitForBaiduRateLimit(options: Options): Promise<void> {
  if (!options.baiduRateLimit) return;
  if (options.baiduMinIntervalMs <= 0 && options.baiduCooldownMs <= 0) return;
  const state = readRateLimitState(options.profileDir);
  const now = Date.now();
  const waitUntil = Math.max(
    state.cooldownUntil ? Date.parse(state.cooldownUntil) || 0 : 0,
    state.lastAttemptAt && options.baiduMinIntervalMs > 0
      ? (Date.parse(state.lastAttemptAt) || 0) + options.baiduMinIntervalMs
      : 0,
  );
  const waitMs = waitUntil - now;
  if (waitMs > 0) {
    writeDiagnostics(options, {
      event: "rate_limit_wait",
      source: "baidu",
      mode: options.baiduMode,
      reason: state.reason || "baidu rate limit spacing",
      details: {
        waitMs,
        cooldownUntil: state.cooldownUntil,
        lastAttemptAt: state.lastAttemptAt,
      },
    });
    runtimeInfo(`百度指数频率控制：等待 ${Math.ceil(waitMs / 1000)} 秒后继续查询...`);
    await sleep(waitMs);
  }
  await writeRateLimitState(options.profileDir, {
    ...state,
    source: "baidu",
    lastAttemptAt: new Date().toISOString(),
    version: 1,
  });
}

export async function updateBaiduRateLimitFromOutput(options: Options, output: CollectOutput): Promise<void> {
  if (!options.baiduRateLimit || options.baiduCooldownMs <= 0) return;
  const reason = baiduRateLimitReason(output);
  if (!reason) return;
  const cooldownUntil = new Date(Date.now() + options.baiduCooldownMs).toISOString();
  const state = readRateLimitState(options.profileDir);
  await writeRateLimitState(options.profileDir, {
    ...state,
    source: "baidu",
    cooldownUntil,
    reason,
    version: 1,
  });
  writeDiagnostics(options, {
    event: "rate_limited",
    source: "baidu",
    mode: options.baiduMode,
    reason,
    details: { cooldownUntil, cooldownMs: options.baiduCooldownMs },
  });
}

export function baiduRateLimitReason(output: CollectOutput): string | undefined {
  const candidates = [
    output.reason,
    output.error,
    output.indices?.search?.error,
    output.indices?.feed?.error,
  ];
  return candidates.find((item) => item && RATE_LIMIT_TEXT_RE.test(item));
}

function readRateLimitState(profileDir: string): RateLimitState {
  const path = rateLimitStatePath(profileDir);
  if (!existsSync(path)) return { source: "baidu", version: 1 };
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<RateLimitState>;
    if (data.version !== 1 || data.source !== "baidu") return { source: "baidu", version: 1 };
    return { source: "baidu", version: 1, ...data };
  } catch {
    return { source: "baidu", version: 1 };
  }
}

async function writeRateLimitState(profileDir: string, state: RateLimitState): Promise<void> {
  const path = rateLimitStatePath(profileDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function rateLimitStatePath(profileDir: string): string {
  return join(profileDir, RATE_LIMIT_STATE_FILE);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
