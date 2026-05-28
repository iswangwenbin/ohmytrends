#!/usr/bin/env bun
import { DEFAULT_URL } from "./config.js";
import { readLanguage } from "./i18n.js";
import { runtimeError, runtimeInfo, runtimeWarn } from "./logger.js";
import { runLoginPrompts } from "./login-prompts.js";
import { logoutProfiles } from "./logout.js";
import { runMainMenuPrompts } from "./menu-prompts.js";
import { readOptions } from "./options.js";
import { printOutputJson, printOutputSummary, writeJsonOutput, writeOutput } from "./output.js";
import { collectAllSources, collectFailures, collectSource, type MultiSourceCollection } from "./runner.js";
import { startServer } from "./server.js";
import { toUnifiedMultiSourceOutput, toUnifiedOutput } from "./unified-output.js";
import type { TerminalLanguage } from "./types.js";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const lang = readLanguage(process.argv.slice(2));

  if (!command) {
    await runMainMenuPrompts();
    if (process.stdout.isTTY && promptsEnabled()) return;
    printHelp(lang);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp(lang);
    return;
  }

  if (command === "serve") {
    await startServer(args);
    return;
  }

  if (command === "login") {
    await runLoginPrompts(args);
    return;
  }

  if (command === "logout") {
    await runLogoutCommand(args);
    return;
  }

  if (command !== "get") {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = readOptions(args);
  if (options.source === "all") {
    await runAllSources(options);
    return;
  }

  const output = await collectSource(options.source, options);
  if (options.format === "json") {
    const unified = toUnifiedOutput(output, options);
    writeJsonOutput(unified, options.out);
    printOutputJson(unified);
  } else {
    writeOutput(output, options.out);
    printOutputSummary(output, options);
  }
}

function promptsEnabled(): boolean {
  return process.env.OHMYTRENDS_NO_PROMPTS !== "true";
}

async function runAllSources(options: ReturnType<typeof readOptions>): Promise<void> {
  const collection = await collectAllSources(options);
  const { outputs, sourceOptions } = collection;
  warnSourceFailures(collection, options.lang);

  if (options.format === "json") {
    const unified = toUnifiedMultiSourceOutput([
      toUnifiedOutput(outputs[0], sourceOptions[0]),
      toUnifiedOutput(outputs[1], sourceOptions[1]),
    ], options);
    writeJsonOutput(unified, options.out);
    printOutputJson(unified);
    return;
  }

  const tableOutput = {
    schemaVersion: 1,
    source: "all",
    capturedAt: new Date().toISOString(),
    results: outputs,
  };
  writeJsonOutput(tableOutput, options.out);
  printOutputSummary(outputs[0], sourceOptions[0]);
  console.log("");
  printOutputSummary(outputs[1], sourceOptions[1]);
}

function warnSourceFailures(collection: MultiSourceCollection, lang: TerminalLanguage): void {
  for (const failure of collectFailures(collection)) {
    const label = failure.source === "baidu"
      ? (lang === "zh" ? "百度指数" : "Baidu Index")
      : "Google Trends";
    runtimeWarn(lang === "zh"
      ? `${label} 查询失败：${failure.message}`
      : `${label} query failed: ${failure.message}`);
  }
}

async function runLogoutCommand(args: string[]): Promise<void> {
  const lang = readLanguage(args);
  const results = await logoutProfiles(args);
  for (const result of results) {
    const status = lang === "zh"
      ? (result.removed ? "已清理" : "未找到")
      : (result.removed ? "Removed" : "Not found");
    const label = result.source === "baidu" ? (lang === "zh" ? "百度指数" : "Baidu Index") : "Google Trends";
    runtimeInfo(lang === "zh"
      ? `${status} ${label} 登录资料：${result.profileDir}`
      : `${status} ${label} login profile: ${result.profileDir}`);
  }
}

function printHelp(lang: TerminalLanguage): void {
  if (lang === "zh") {
    console.log(`ohmytrends <command>

命令：
  login [--source baidu|google] [--profile-dir profiles]
  logout [baidu|google|all] [--profile-dir profiles]
  serve [--host 127.0.0.1] [--port 3000] [--queue true] [--queue-db data/queue.sqlite] [--profile-dir profiles]
  get [--source baidu|google|all] [--words codex,claude] [--url URL] [--out exports/ohmytrends.json]
          [--profile-dir profiles/baidu|profiles/google] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]
          [--range 30d] [--geo US] [--area 0]
          [--baidu-mode page|api]
          [--log logs/events.jsonl]
          [--format table|json] [--headless false] [--keep-open true] [--login-timeout-ms 300000]
          [--baidu-rate-limit true] [--baidu-min-interval-ms 15000] [--baidu-cooldown-ms 120000]
          [--lang zh|en]

示例：
  bun src/cli.ts login
  bun src/cli.ts logout google
  bun src/cli.ts serve
  bun src/cli.ts login --source google
  bun src/cli.ts get --words 微信指数
  bun src/cli.ts get --source all --words "微信指数,google" --format json
  bun src/cli.ts get --source google --words "codex app" --out exports/google-trends-codex-app.json
  bun src/cli.ts get --source google --words agy --geo US --range 1y

说明：
  默认 source 是 all，会用相同关键词和时间范围同时查询百度指数和 Google Trends。
  默认 profile 是 profiles/baidu 和 profiles/google。
  默认 range 是 30d。
  login 不传 --source 时会把 --profile-dir 当成根目录，并追加 /baidu 和 /google。
  logout 沿用 login 的 profile-dir 行为，并清理已保存的浏览器会话。
  Google Trends 每次最多支持 5 个对比关键词。
  可用 --range 1h|4h|1d|7d|30d|90d|180d|1y|5y|all 表示统一时间范围。
  百度默认使用 --baidu-mode page，通过页面模拟输入和点击采集；需要接口快路径时可设为 api。
  默认只把拦截到的原始请求/响应写入 logs/events.jsonl；显式传 --log path.jsonl 时写入完整诊断事件；可用 --log false 关闭。
  serve 默认让 /api/trends 创建 SQLite 查询任务并返回查询 ID；用 GET /api/trends/<id> 轮询结果。可用 --queue false 改回同步调试模式。
  百度查询默认开启频率控制：最小间隔 15 秒，命中频率风控后冷却 120 秒；可用 --baidu-rate-limit false 关闭。
  可用 --format json 输出适合程序读取的数据。
  可用 --lang zh|en 切换终端语言。

百度默认 URL：
  ${DEFAULT_URL}
`);
    return;
  }

  console.log(`ohmytrends <command>

Commands:
  login [--source baidu|google] [--profile-dir profiles]
  logout [baidu|google|all] [--profile-dir profiles]
  serve [--host 127.0.0.1] [--port 3000] [--queue true] [--queue-db data/queue.sqlite] [--profile-dir profiles]
  get [--source baidu|google|all] [--words codex,claude] [--url URL] [--out exports/ohmytrends.json]
          [--profile-dir profiles/baidu|profiles/google] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]
          [--range 30d] [--geo US] [--area 0]
          [--baidu-mode page|api]
          [--log logs/events.jsonl]
          [--format table|json] [--headless false] [--keep-open true] [--login-timeout-ms 300000]
          [--baidu-rate-limit true] [--baidu-min-interval-ms 15000] [--baidu-cooldown-ms 120000]
          [--lang zh|en]

Examples:
  bun src/cli.ts login
  bun src/cli.ts logout google
  bun src/cli.ts serve
  bun src/cli.ts login --source google
  bun src/cli.ts get --words 微信指数
  bun src/cli.ts get --source all --words "微信指数,google" --format json
  bun src/cli.ts get --source google --words "codex app" --out exports/google-trends-codex-app.json
  bun src/cli.ts get --source google --words agy --geo US --range 1y

Notes:
  Default source is all, which runs Baidu and Google with the same words and range.
  Default profiles are profiles/baidu and profiles/google.
  Default range is 30d for both sources.
  login without --source treats --profile-dir as a root and appends /baidu and /google.
  logout follows the same profile-dir behavior as login and removes saved browser sessions.
  Google Trends supports up to 5 comparison keywords in one request.
  Use --range 1h|4h|1d|7d|30d|90d|180d|1y|5y|all for a source-neutral range.
  Baidu defaults to --baidu-mode page, which uses page input/click simulation. Use api for the faster direct API path.
  By default only intercepted raw requests/responses are written to logs/events.jsonl. Passing --log path.jsonl writes full diagnostics. Use --log false to disable.
  serve makes /api/trends create a SQLite-backed query and return its ID by default. Poll GET /api/trends/<id> for the result. Use --queue false for synchronous debugging.
  Baidu rate limiting is enabled by default: 15s minimum spacing and 120s cooldown after rate-limit responses. Use --baidu-rate-limit false to disable.
  Use --format json for machine-readable stdout.
  Use --lang zh|en to switch terminal language.

Baidu default URL:
  ${DEFAULT_URL}
`);
}

main().catch((error: unknown) => {
  runtimeError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
