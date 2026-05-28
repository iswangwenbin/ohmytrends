import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { writeDiagnostics } from "../src/diagnostics.js";
import type { Options } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("diagnostics logging", () => {
  test("default log only records intercepted request and response events", async () => {
    const root = await mkdtemp(join(tmpdir(), "ohmytrends-diagnostics-"));
    tempDirs.push(root);
    const options = optionsWithLog(join(root, "logs/events.jsonl"));
    options.diagnosticsLogDefault = true;

    writeDiagnostics(options, { event: "collection_start", source: "baidu" });
    expect(existsSync(options.diagnosticsLogPath!)).toBe(false);

    writeDiagnostics(options, {
      event: "baidu_intercept_response",
      source: "baidu",
      details: { response: { status: 10001, message: "speed limit" } },
    });

    const lines = (await readFile(options.diagnosticsLogPath!, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).event).toBe("baidu_intercept_response");
  });

  test("custom log records all diagnostics events", async () => {
    const root = await mkdtemp(join(tmpdir(), "ohmytrends-diagnostics-"));
    tempDirs.push(root);
    const options = optionsWithLog(join(root, "logs/debug.jsonl"));
    options.diagnosticsLogDefault = false;

    writeDiagnostics(options, { event: "collection_start", source: "baidu" });
    writeDiagnostics(options, { event: "collection_complete", source: "baidu", status: "no_data" });

    const lines = (await readFile(options.diagnosticsLogPath!, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["collection_start", "collection_complete"]);
  });
});

function optionsWithLog(path: string): Options {
  return {
    source: "baidu",
    lang: "zh",
    url: "https://index.baidu.com/",
    words: ["gpt"],
    profileDir: "profiles/baidu",
    out: "exports/baidu-index.json",
    format: "json",
    raw: false,
    headless: true,
    keepOpen: false,
    diagnosticsLogPath: path,
    timeoutMs: 60_000,
    loginTimeoutMs: 300_000,
    baiduRateLimit: true,
    baiduMinIntervalMs: 15_000,
    baiduCooldownMs: 120_000,
    baiduMode: "page",
    googleMode: "page",
    geo: "",
    area: "0",
  };
}
