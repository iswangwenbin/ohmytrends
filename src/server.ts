import { Elysia } from "elysia";
import { DEFAULT_QUEUE_DB } from "./config.js";
import tailwindCss from "./generated/tailwind.css" with { type: "text" };
import { readLanguage } from "./i18n.js";
import { TrendJobQueue } from "./job-queue.js";
import { runtimeInfo } from "./logger.js";
import { readFlag, readOptions } from "./options.js";
import { collectUnified } from "./runner.js";
import type { Options, SourceOption, TerminalLanguage } from "./types.js";
import type { UnifiedMultiSourceOutput, UnifiedOutput } from "./unified-output.js";

type ApiRequest = {
  source?: SourceOption;
  words?: string[] | string;
  log?: string;
  range?: string;
  startDate?: string;
  endDate?: string;
  geo?: string;
  area?: string;
  profileDir?: string;
  raw?: boolean;
  headless?: boolean;
  keepOpen?: boolean;
  timeoutMs?: number;
  loginTimeoutMs?: number;
  baiduMinIntervalMs?: number;
  baiduCooldownMs?: number;
  baiduRateLimit?: boolean;
  lang?: TerminalLanguage;
  baiduMode?: string;
  googleMode?: string;
  wait?: boolean | string | number;
  waitTimeoutMs?: number | string;
};

type ServerOptions = {
  queueEnabled?: boolean;
  collect?: (options: Options) => Promise<UnifiedOutput | UnifiedMultiSourceOutput>;
};

export async function startServer(args: string[]): Promise<void> {
  const host = readFlag(args, "--host") || process.env.OHMYTRENDS_HOST || "127.0.0.1";
  const port = readPort(readFlag(args, "--port") || process.env.OHMYTRENDS_PORT || "3000");
  const queueDb = readFlag(args, "--queue-db") || process.env.OHMYTRENDS_QUEUE_DB || DEFAULT_QUEUE_DB;
  const queueEnabled = readServerBoolean(args, "--queue", "OHMYTRENDS_QUEUE", true);
  const baseArgs = withoutServerFlags(args);
  const lang = readLanguage(args);

  const app = createServerWithQueue(baseArgs, new TrendJobQueue(queueDb), { queueEnabled });
  app.listen({ hostname: host, port });
  runtimeInfo(lang === "zh"
    ? [
      `ohmytrends API 已启动：http://${host}:${port}`,
      `示例页面：http://${host}:${port}`,
      "",
      "提交关键词趋势查询示例：",
      `curl "http://${host}:${port}/api/trends?source=all&words=gpt,claude&range=30d"`,
      "然后轮询返回的 pollUrl，直到 status 为 succeeded 或 failed。",
    ].join("\n")
    : [
      `ohmytrends API started: http://${host}:${port}`,
      `Example page: http://${host}:${port}`,
      "",
      "Example keyword trend query submission:",
      `curl "http://${host}:${port}/api/trends?source=all&words=gpt,claude&range=30d"`,
      "Then poll the returned pollUrl until status is succeeded or failed.",
    ].join("\n"));
}

export function createServer(baseArgs: string[] = []) {
  const queue = new TrendJobQueue(":memory:");
  return createServerWithQueue(baseArgs, queue);
}

export function createServerWithQueue(baseArgs: string[] = [], queue: TrendJobQueue, options: ServerOptions = {}) {
  const queueEnabled = options.queueEnabled ?? true;
  const collect = options.collect || collectUnified;
  return new Elysia()
    .get("/", () => new Response(renderExamplePage(), {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    }))
    .get("/health", () => ({
      ok: true,
      service: "ohmytrends",
    }))
    .get("/api/health", () => ({
      ok: true,
      service: "ohmytrends",
    }))
    .get("/api/trends/jobs", ({ query }) => {
      const limit = readJobLimit((query as Record<string, unknown>).limit);
      return {
        schemaVersion: 1,
        jobs: queue.list(limit).map(jobResponse),
      };
    })
    .post("/api/trends/jobs", ({ body, set }) => {
      try {
        const options = optionsFromRequest(baseArgs, body as ApiRequest | undefined);
        const job = queue.enqueue(options);
        set.status = 202;
        return jobResponse(job);
      } catch (error) {
        set.status = 400;
        return errorResponse(error);
      }
    })
    .get("/api/trends/jobs/:id", ({ params, set }) => {
      const job = queue.get(params.id);
      if (!job) {
        set.status = 404;
        return errorResponse(new Error(`Job not found: ${params.id}`));
      }
      return jobResponse(job);
    })
    .get("/api/trends/sync", async ({ query, set }) => {
      return await submitTrendQuery(
        baseArgs,
        { ...(query as Record<string, unknown>), wait: true },
        set,
        queue,
        queueEnabled,
        collect,
      );
    })
    .post("/api/trends/sync", async ({ body, set }) => {
      return await submitTrendQuery(
        baseArgs,
        { ...((body as ApiRequest | undefined) || {}), wait: true },
        set,
        queue,
        queueEnabled,
        collect,
      );
    })
    .get("/api/trends/:id", ({ params, set }) => {
      const job = queue.get(params.id);
      if (!job) {
        set.status = 404;
        return errorResponse(new Error(`Query not found: ${params.id}`));
      }
      if (job.status === "failed") set.status = 500;
      return jobResponse(job);
    })
    .get("/api/trends", async ({ query, set }) => {
      return await submitTrendQuery(baseArgs, query as Record<string, unknown>, set, queue, queueEnabled, collect);
    })
    .post("/api/trends", async ({ body, set }) => {
      return await submitTrendQuery(baseArgs, body as ApiRequest | undefined, set, queue, queueEnabled, collect);
    });
}

function jobResponse(job: ReturnType<TrendJobQueue["get"]> extends infer T ? NonNullable<T> : never) {
  return {
    schemaVersion: 1,
    id: job.id,
    queryId: job.id,
    status: job.status,
    pollUrl: `/api/trends/${job.id}`,
    source: job.options.source,
    words: job.options.words,
    range: job.options.rangeLabel || job.options.range,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

async function submitTrendQuery(
  baseArgs: string[],
  input: ApiRequest | Record<string, unknown> | undefined,
  set: { status?: number | string },
  queue: TrendJobQueue,
  queueEnabled: boolean,
  collect: (options: Options) => Promise<UnifiedOutput | UnifiedMultiSourceOutput>,
) {
  let options: ReturnType<typeof optionsFromRequest>;
  let wait: boolean;
  let waitTimeoutMs: number;
  try {
    wait = readWaitFlag(input);
    waitTimeoutMs = readWaitTimeoutMs(input);
    options = optionsFromRequest(baseArgs, input);
  } catch (error) {
    set.status = 400;
    return errorResponse(error);
  }
  if (!queueEnabled) return await collectSyncOutput(options, set, collect);
  const job = queue.enqueue(options);
  if (!wait) {
    set.status = 202;
    return jobResponse(job);
  }
  const completed = await queue.waitForCompletion(job.id, { pollIntervalMs: 100, timeoutMs: waitTimeoutMs });
  if (!completed) {
    set.status = 404;
    return errorResponse(new Error(`Query not found: ${job.id}`));
  }
  if (completed.status === "queued" || completed.status === "running") set.status = 202;
  if (completed.status === "failed") set.status = 500;
  return jobResponse(completed);
}

async function collectSyncOutput(
  options: ReturnType<typeof optionsFromRequest>,
  set: { status?: number | string },
  collect: (options: Options) => Promise<UnifiedOutput | UnifiedMultiSourceOutput>,
) {
  try {
    return await collect(options);
  } catch (error) {
    set.status = 500;
    return errorResponse(error);
  }
}

function readJobLimit(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : undefined;
  return Number.isInteger(number) && number! > 0 && number! <= 500 ? number! : 50;
}

function readWaitFlag(input: ApiRequest | Record<string, unknown> | undefined): boolean {
  const value = input?.wait;
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  throw new Error(`Invalid wait: ${String(value)}. Expected true or false`);
}

function readWaitTimeoutMs(input: ApiRequest | Record<string, unknown> | undefined): number {
  const value = input?.waitTimeoutMs;
  if (value === undefined || value === null || value === "") return 0;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (Number.isFinite(number) && number >= 0) return number;
  throw new Error(`Invalid waitTimeoutMs: ${String(value)}. Expected a non-negative number`);
}

function optionsFromRequest(baseArgs: string[], input: ApiRequest | Record<string, unknown> = {}) {
  return readOptions([
    ...baseArgs,
    "--format",
    "json",
    ...argsFromRequest(input),
  ]);
}

function argsFromRequest(input: ApiRequest | Record<string, unknown>): string[] {
  const args: string[] = [];
  pushString(args, "--source", input.source);
  pushWords(args, input.words);
  pushString(args, "--range", input.range);
  pushString(args, "--start-date", input.startDate);
  pushString(args, "--end-date", input.endDate);
  pushString(args, "--geo", input.geo);
  pushString(args, "--area", input.area);
  pushString(args, "--profile-dir", input.profileDir);
  pushBoolean(args, "--raw", input.raw);
  pushBoolean(args, "--headless", input.headless);
  pushBoolean(args, "--keep-open", input.keepOpen);
  pushNumber(args, "--timeout-ms", input.timeoutMs);
  pushNumber(args, "--login-timeout-ms", input.loginTimeoutMs);
  pushNumber(args, "--baidu-min-interval-ms", input.baiduMinIntervalMs);
  pushNumber(args, "--baidu-cooldown-ms", input.baiduCooldownMs);
  pushBoolean(args, "--baidu-rate-limit", input.baiduRateLimit);
  pushString(args, "--log", input.log);
  pushString(args, "--lang", input.lang);
  pushString(args, "--baidu-mode", input.baiduMode);
  pushString(args, "--google-mode", input.googleMode);
  return args;
}

function pushString(args: string[], flag: string, value: unknown): void {
  if (typeof value !== "string" || value.length === 0) return;
  args.push(flag, value);
}

function pushWords(args: string[], value: unknown): void {
  if (value === undefined || value === null) return;
  const words = normalizeWords(value);
  if (words.length === 0) throw new Error("Invalid words: expected at least one keyword");
  args.push("--words", words.join(","));
}

function normalizeWords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitWords(String(item)));
  }
  if (typeof value === "string") {
    return splitWords(value);
  }
  return splitWords(String(value));
}

function splitWords(value: string): string[] {
  return value.split(/[,\uFF0C\u3001\uFF1B;]+/).map((word) => word.trim()).filter(Boolean);
}

function pushBoolean(args: string[], flag: string, value: unknown): void {
  if (typeof value === "boolean") args.push(flag, String(value));
  if (typeof value === "string" && /^(true|false)$/.test(value)) args.push(flag, value);
}

function pushNumber(args: string[], flag: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) args.push(flag, String(value));
  if (typeof value === "string" && value.length > 0) args.push(flag, value);
}

function readPort(value: string): number {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port < 65_536) return port;
  throw new Error(`Invalid --port: ${value}. Expected a TCP port number`);
}

function withoutServerFlags(args: string[]): string[] {
  const serverFlags = new Set(["--host", "--port", "--queue-db", "--queue"]);
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name] = arg.split("=", 1);
    if (serverFlags.has(name)) {
      if (!arg.includes("=")) index += 1;
      continue;
    }
    result.push(arg);
  }
  return result;
}

function readServerBoolean(args: string[], flag: string, envName: string, fallback: boolean): boolean {
  const value = readFlag(args, flag) ?? process.env[envName];
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid ${flag}: ${value}. Expected true or false`);
}

function errorResponse(error: unknown) {
  return {
    schemaVersion: 1,
    source: "api",
    status: "error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function renderExamplePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ohmytrends API Example</title>
  <style>${tailwindCss}</style>
</head>
<body class="min-h-screen bg-paper text-ink antialiased">
  <main class="mx-auto min-h-screen w-full max-w-[1720px] px-4 py-3 sm:px-6">
    <nav id="top-nav" class="mx-auto mb-6 flex max-w-[760px] items-center justify-between border-t border-line pt-3 font-mono text-xs text-muted transition-all duration-300">
      <span data-i18n="navTitle">OhMyTrends API Example</span>
      <span class="hidden items-center gap-2 sm:flex"><span class="h-2 w-2 rounded-full bg-emerald-500"></span><span>GET /api/trends</span></span>
      <div class="flex items-center gap-2">
        <button id="language-toggle" type="button" class="border border-line px-3 py-2 text-ink hover:bg-ink hover:text-paper" aria-label="Switch language">中文</button>
        <a class="border border-line px-4 py-2 text-ink hover:bg-ink hover:text-paper" href="/health" data-i18n="health">Health</a>
      </div>
    </nav>

    <div id="workspace" class="mx-auto grid max-w-[760px] grid-cols-[minmax(0,1fr)_0fr] gap-0 transition-all duration-500 ease-out">
    <section class="min-h-[720px] w-full border border-line bg-[#f8f7f3]">
      <div class="p-8 sm:p-12 lg:p-16">
        <header class="mb-10 text-center">
          <h1 class="mx-auto max-w-none whitespace-nowrap font-serif text-5xl italic leading-none tracking-normal text-ink sm:text-6xl lg:text-7xl">
            <span data-i18n-html="heroTitle">Oh My Trends</span>
          </h1>
          <p class="mx-auto mt-7 max-w-[620px] whitespace-nowrap text-sm leading-6 text-muted sm:text-base">
            <span data-i18n="heroCopy">Query Google Trends and Baidu Index through the local API.</span>
          </p>
        </header>

        <form id="query-form" class="space-y-7">
          <div>
            <label class="mb-2 block font-mono text-xs uppercase tracking-[0.22em] text-muted" for="words" data-i18n="keywordsLabel">keywords</label>
            <input id="words" name="words" value="gpt,claude" autocomplete="off" class="h-14 w-full border border-line bg-transparent px-5 font-mono text-base outline-none placeholder:text-muted focus:bg-white" placeholder="gpt,claude,gemini">
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-2 block font-mono text-xs uppercase tracking-[0.22em] text-muted" data-i18n="sourceLabel">source</span>
              <select id="source" name="source" class="h-12 w-full border border-line bg-transparent px-4 font-mono text-sm outline-none focus:bg-white">
                <option value="all">all</option>
                <option value="google">google</option>
                <option value="baidu">baidu</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-2 block font-mono text-xs uppercase tracking-[0.22em] text-muted" data-i18n="rangeLabel">range</span>
              <select id="range" name="range" class="h-12 w-full border border-line bg-transparent px-4 font-mono text-sm outline-none focus:bg-white">
                <option value="30d">30d</option>
                <option value="7d">7d</option>
                <option value="90d">90d</option>
                <option value="180d">180d</option>
                <option value="1y">1y</option>
                <option value="5y">5y</option>
                <option value="all">all</option>
              </select>
            </label>
          </div>

          <button id="submit" type="submit" class="h-14 border border-line bg-ink px-8 font-mono text-sm font-semibold text-paper transition hover:bg-transparent hover:text-ink disabled:cursor-wait disabled:opacity-60" data-i18n="fetchButton">Fetch</button>
        </form>

        <div class="my-10 border-t border-line"></div>

        <section class="grid gap-5 sm:grid-cols-[180px_1fr]">
          <div>
            <h2 class="font-mono text-sm font-bold" data-i18n="requestTitle">Request</h2>
            <p class="mt-2 font-mono text-xs leading-5 text-muted" data-i18n="requestSubtitle">Real API examples</p>
          </div>
          <div class="space-y-4">
            <div class="flex flex-wrap gap-2" id="code-tabs">
              <button type="button" data-code-tab="curl" class="code-tab border border-line bg-ink px-3 py-2 font-mono text-xs text-paper">CURL</button>
              <button type="button" data-code-tab="typescript" class="code-tab border border-line px-3 py-2 font-mono text-xs text-ink hover:bg-ink hover:text-paper">Typescript</button>
              <button type="button" data-code-tab="python" class="code-tab border border-line px-3 py-2 font-mono text-xs text-ink hover:bg-ink hover:text-paper">Python</button>
              <button type="button" data-code-tab="go" class="code-tab border border-line px-3 py-2 font-mono text-xs text-ink hover:bg-ink hover:text-paper">Golang</button>
            </div>
            <div class="relative">
              <button id="copy-request-code" type="button" class="absolute right-3 top-3 flex h-9 w-9 items-center justify-center border border-[#d8f3dc]/50 bg-[#111111] text-[#d8f3dc] transition hover:bg-[#d8f3dc] hover:text-[#111111]" aria-label="Copy request example" title="Copy request example">
                <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 fill-none stroke-current stroke-2">
                  <rect x="9" y="9" width="10" height="10" rx="1.5"></rect>
                  <path d="M5 15.5V6.5A1.5 1.5 0 0 1 6.5 5h9"></path>
                </svg>
              </button>
              <pre id="request-code" class="min-h-[220px] overflow-auto border border-line bg-[#111111] p-4 pr-16 font-mono text-xs leading-6 text-[#d8f3dc] whitespace-pre-wrap break-words"></pre>
            </div>
            <p id="request-url" class="break-all font-mono text-xs leading-5 text-muted">GET /api/trends?source=all&amp;words=gpt,claude&amp;range=30d</p>
          </div>
        </section>
      </div>
    </section>

  <aside id="response-drawer" class="flex min-h-[720px] w-full min-w-0 overflow-hidden border border-transparent bg-[#f5f3ee] opacity-0 transition-opacity duration-300 ease-out">
      <div id="response-panel" class="flex w-[760px] shrink-0 flex-col border border-line p-8 sm:p-12 lg:p-16">
        <div class="relative z-10 flex min-h-0 flex-1 flex-col">
          <div class="mb-8 flex items-center justify-between border-b border-line pb-4 font-mono text-xs uppercase tracking-[0.2em] text-muted">
            <span data-i18n="responseTitle">response</span>
            <div class="flex items-center gap-4">
              <span id="status" class="inline-flex items-center gap-2 normal-case tracking-normal"><span class="h-2 w-2 rounded-full bg-neutral-400"></span><span data-i18n="readyStatus">Ready</span></span>
              <button id="close-drawer" type="button" class="border border-line px-3 py-1 text-ink hover:bg-ink hover:text-paper" data-i18n="closeButton">Close</button>
            </div>
          </div>

          <div class="mb-6 grid gap-3 sm:grid-cols-2">
            <div class="border border-line bg-[#f8f7f3]/80 p-4">
              <p class="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted" data-i18n="queryIdLabel">query id</p>
              <strong id="meta-query-id" class="block break-all font-mono text-sm leading-6">-</strong>
            </div>
            <div class="border border-line bg-[#f8f7f3]/80 p-4">
              <p class="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted" data-i18n="pollUrlLabel">poll url</p>
              <strong id="meta-poll-url" class="block break-all font-mono text-sm leading-6">-</strong>
            </div>
            <div class="border border-line bg-[#f8f7f3]/80 p-4">
              <p class="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted" data-i18n="sourceLabel">source</p>
              <strong id="meta-source" class="block break-words font-mono text-sm leading-6">-</strong>
            </div>
            <div class="border border-line bg-[#f8f7f3]/80 p-4">
              <p class="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted" data-i18n="statusLabel">status</p>
              <strong id="meta-status" class="block break-words font-mono text-sm leading-6">-</strong>
            </div>
            <div class="border border-line bg-[#f8f7f3]/80 p-4">
              <p class="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted" data-i18n="keywordsLabel">keywords</p>
              <strong id="meta-keywords" class="block break-words font-mono text-sm leading-6">-</strong>
            </div>
            <div class="border border-line bg-[#f8f7f3]/80 p-4">
              <p class="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted" data-i18n="capturedLabel">captured</p>
              <strong id="meta-captured" class="block break-words font-mono text-sm leading-6">-</strong>
            </div>
          </div>

          <div class="relative z-10 flex min-h-0 flex-1 flex-col">
            <button id="copy-json-output" type="button" class="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center border border-[#d8f3dc]/50 bg-[#111111] text-[#d8f3dc] transition hover:bg-[#d8f3dc] hover:text-[#111111]" aria-label="Copy JSON response" title="Copy JSON response">
              <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 fill-none stroke-current stroke-2">
                <rect x="9" y="9" width="10" height="10" rx="1.5"></rect>
                <path d="M5 15.5V6.5A1.5 1.5 0 0 1 6.5 5h9"></path>
              </svg>
            </button>
            <pre id="json-output" class="min-h-0 flex-1 overflow-auto border border-line bg-[#111111] p-5 pr-16 font-mono text-sm leading-6 text-[#d8f3dc] whitespace-pre-wrap break-words"><span data-i18n="outputPlaceholder">Submit the form to query /api/trends.</span></pre>
          </div>
        </div>
      </div>
  </aside>
    </div>
  </main>

  <script>
    const form = document.querySelector("#query-form");
    const button = document.querySelector("#submit");
    const topNav = document.querySelector("#top-nav");
    const workspace = document.querySelector("#workspace");
    const drawer = document.querySelector("#response-drawer");
    const closeDrawer = document.querySelector("#close-drawer");
    const languageToggle = document.querySelector("#language-toggle");
    const output = document.querySelector("#json-output");
    const copyJsonOutput = document.querySelector("#copy-json-output");
    const status = document.querySelector("#status");
    const requestUrl = document.querySelector("#request-url");
    const requestCode = document.querySelector("#request-code");
    const copyRequestCode = document.querySelector("#copy-request-code");
    const codeTabs = Array.from(document.querySelectorAll(".code-tab"));
    const metaSource = document.querySelector("#meta-source");
    const metaStatus = document.querySelector("#meta-status");
    const metaKeywords = document.querySelector("#meta-keywords");
    const metaCaptured = document.querySelector("#meta-captured");
    const metaQueryId = document.querySelector("#meta-query-id");
    const metaPollUrl = document.querySelector("#meta-poll-url");
    let activeCodeTab = "curl";
    let loadingTimer = undefined;
    let language = navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
    const translations = {
      en: {
        navTitle: "OhMyTrends API Example",
        health: "Health",
        eyebrow: "api client example",
        heroTitle: "Oh My Trends",
        heroCopy: "Query Google Trends and Baidu Index through the local API.",
        keywordsLabel: "keywords",
        sourceLabel: "source",
        rangeLabel: "range",
        geoLabel: "google geo",
        fetchButton: "Fetch",
        fetchingButton: "Fetching...",
        requestTitle: "Request",
        requestSubtitle: "Real API examples",
        responseTitle: "response",
        readyStatus: "Ready",
        requestingStatus: "Requesting",
        submittedStatus: "Submitted",
        pollingStatus: "Polling",
        completeStatus: "Complete",
        failedStatus: "Failed",
        queryIdLabel: "query id",
        pollUrlLabel: "poll url",
        statusLabel: "status",
        capturedLabel: "captured",
        outputPlaceholder: "Submit the form to query /api/trends.",
        loadingLabel: "Loading",
        closeButton: "Close",
        copyRequestExample: "Copy request example",
        copiedRequestExample: "Copied",
        copyJsonResponse: "Copy JSON response",
        copiedJsonResponse: "Copied"
      },
      zh: {
        navTitle: "OhMyTrends API Example",
        health: "健康检查",
        eyebrow: "API 客户端示例",
        heroTitle: "Oh My Trends",
        heroCopy: "通过本地 API 查询 Google Trends 和百度指数。",
        keywordsLabel: "关键词",
        sourceLabel: "数据源",
        rangeLabel: "时间范围",
        geoLabel: "Google 地区",
        fetchButton: "获取 JSON",
        fetchingButton: "请求中...",
        requestTitle: "请求",
        requestSubtitle: "多语言 API 示例",
        responseTitle: "响应",
        readyStatus: "就绪",
        requestingStatus: "请求中",
        submittedStatus: "已提交",
        pollingStatus: "轮询中",
        completeStatus: "完成",
        failedStatus: "失败",
        queryIdLabel: "查询 ID",
        pollUrlLabel: "轮询 URL",
        statusLabel: "状态",
        capturedLabel: "采集时间",
        outputPlaceholder: "提交表单后会请求 /api/trends。",
        loadingLabel: "查询中",
        closeButton: "关闭",
        copyRequestExample: "复制请求示例",
        copiedRequestExample: "已复制",
        copyJsonResponse: "复制 JSON 响应",
        copiedJsonResponse: "已复制"
      }
    };
    let copy = translations[language];
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";

    function applyI18n() {
      for (const node of document.querySelectorAll("[data-i18n]")) {
        const key = node.dataset.i18n;
        if (copy[key]) node.textContent = copy[key];
      }
      for (const node of document.querySelectorAll("[data-i18n-html]")) {
        const key = node.dataset.i18nHtml;
        if (copy[key]) node.innerHTML = copy[key];
      }
      languageToggle.textContent = language === "zh" ? "EN" : "中文";
      languageToggle.setAttribute("aria-label", language === "zh" ? "Switch to English" : "切换到中文");
      copyRequestCode.setAttribute("aria-label", copy.copyRequestExample);
      copyRequestCode.setAttribute("title", copy.copyRequestExample);
      copyJsonOutput.setAttribute("aria-label", copy.copyJsonResponse);
      copyJsonOutput.setAttribute("title", copy.copyJsonResponse);
    }

    function switchLanguage() {
      language = language === "zh" ? "en" : "zh";
      copy = translations[language];
      document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
      applyI18n();
      updateRequestExamples();
      if (!loadingTimer) {
        setStatus("ready", copy.readyStatus);
      }
    }

    function setStatus(kind, text) {
      const colors = {
        ready: "bg-neutral-400",
        ok: "bg-emerald-500",
        warn: "bg-amber-500",
        error: "bg-red-500"
      };
      status.innerHTML = '<span class="h-2 w-2 rounded-full ' + (colors[kind] || colors.ready) + '"></span>' + text;
    }

    function setMeta(data) {
      const payload = data.result || data;
      metaQueryId.textContent = data.id || "-";
      metaPollUrl.textContent = data.pollUrl || (data.id ? "/api/trends/" + data.id : "-");
      metaSource.textContent = payload.source || data.source || "-";
      metaStatus.textContent = data.status || payload.status || "-";
      const keywords = Array.isArray(payload.query?.keywords)
        ? payload.query.keywords
        : Array.isArray(payload.query?.words)
          ? payload.query.words
          : Array.isArray(data.words)
            ? data.words
            : [];
      metaKeywords.textContent = keywords.length > 0 ? keywords.join(", ") : "-";
      metaCaptured.textContent = payload.capturedAt || data.finishedAt || data.updatedAt || "-";
    }

    function setResultMeta(data) {
      const payload = data.result || data;
      metaQueryId.textContent = data.id || "-";
      metaPollUrl.textContent = data.pollUrl || (data.id ? "/api/trends/" + data.id : "-");
      metaSource.textContent = payload.source || data.source || "-";
      metaStatus.textContent = payload.status || data.status || "-";
      const keywords = Array.isArray(payload.query?.keywords)
        ? payload.query.keywords
        : Array.isArray(payload.query?.words)
          ? payload.query.words
          : Array.isArray(data.words)
            ? data.words
          : [];
      metaKeywords.textContent = keywords.length > 0 ? keywords.join(", ") : "-";
      metaCaptured.textContent = payload.capturedAt || data.finishedAt || "-";
    }

    function setLoadingMeta(text) {
      metaSource.textContent = text;
      metaStatus.textContent = text;
      metaKeywords.textContent = text;
      metaCaptured.textContent = text;
      metaQueryId.textContent = text;
      metaPollUrl.textContent = text;
      output.textContent = text;
    }

    function startLoadingAnimation() {
      stopLoadingAnimation();
      let frame = 0;
      const render = () => {
        const dots = ".".repeat((frame % 6) + 1);
        setLoadingMeta(dots);
        frame += 1;
      };
      render();
      loadingTimer = window.setInterval(render, 320);
    }

    function stopLoadingAnimation() {
      if (loadingTimer) {
        window.clearInterval(loadingTimer);
        loadingTimer = undefined;
      }
    }

    function buildUrl() {
      const params = new URLSearchParams(new FormData(form));
      if (!params.get("geo")) params.delete("geo");
      return "/api/trends?" + params.toString();
    }

    function absoluteUrl() {
      return new URL(buildUrl(), window.location.origin).toString();
    }

    function splitWords(value) {
      return String(value).split(/[,，、；;]+/).map(function (word) { return word.trim(); }).filter(Boolean);
    }

    function requestPayload() {
      const data = new FormData(form);
      const payload = {
        source: data.get("source"),
        words: splitWords(String(data.get("words") || "")),
        range: data.get("range")
      };
      const geo = String(data.get("geo") || "").trim();
      if (geo) payload.geo = geo;
      return payload;
    }

    function codeExample(kind) {
      const url = absoluteUrl();
      const payload = requestPayload();
      const json = JSON.stringify(payload, null, 2);
      if (kind === "typescript") {
        return [
          "const submitted = await fetch(\\"" + url + "\\");",
          "const job = await submitted.json();",
          "",
          "if (!submitted.ok) {",
          "  throw new Error(\`ohmytrends request failed: \${submitted.status}\`);",
          "}",
          "",
          "let polled = job;",
          "while ([\\"queued\\", \\"running\\"].includes(polled.status)) {",
          "  await new Promise((resolve) => setTimeout(resolve, 2000));",
          "  const response = await fetch(polled.pollUrl);",
          "  polled = await response.json();",
          "}",
          "",
          "console.log(polled.result ?? polled);"
        ].join("\\n");
      }
      if (kind === "python") {
        return [
          "import requests",
          "import time",
          "",
          "response = requests.get(\\"" + url + "\\", timeout=30)",
          "response.raise_for_status()",
          "job = response.json()",
          "",
          "while job[\\"status\\"] in (\\"queued\\", \\"running\\"):",
          "    time.sleep(2)",
          "    response = requests.get(\\"" + window.location.origin + "\\" + job[\\"pollUrl\\"], timeout=30)",
          "    response.raise_for_status()",
          "    job = response.json()",
          "",
          "print(job.get(\\"result\\", job))"
        ].join("\\n");
      }
      if (kind === "go") {
        return [
          "package main",
          "",
          "import (",
          "  \\"encoding/json\\"",
          "  \\"fmt\\"",
          "  \\"net/http\\"",
          "  \\"time\\"",
          ")",
          "",
          "func main() {",
          "  client := &http.Client{Timeout: 30 * time.Second}",
          "  resp, err := client.Get(\\"" + url + "\\")",
          "  if err != nil {",
          "    panic(err)",
          "  }",
          "  defer resp.Body.Close()",
          "",
          "  if resp.StatusCode >= 400 {",
          "    panic(resp.Status)",
          "  }",
          "",
          "  var data any",
          "  if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {",
          "    panic(err)",
          "  }",
          "  // Poll GET /api/trends/{id} until status is succeeded or failed.",
          "  fmt.Printf(\\"%#v\\\\n\\", data)",
          "}"
        ].join("\\n");
      }
      return [
        "curl \\"" + url + "\\"",
        "",
        "# Then poll the returned URL:",
        "curl \\"" + window.location.origin + "/api/trends/<query-id>\\"",
        "",
        "# Wait for completion on the same endpoint:",
        "curl \\"" + url + "&wait=true\\"",
        "",
        "# POST works too:",
        "curl -X POST \\"" + window.location.origin + "/api/trends\\" \\\\",
        "  -H \\"content-type: application/json\\" \\\\",
        "  -d '" + json.replaceAll("'", "'\\\\''") + "'"
      ].join("\\n");
    }

    function updateRequestExamples() {
      requestUrl.textContent = "GET " + buildUrl();
      requestCode.textContent = codeExample(activeCodeTab);
    }

    function selectCodeTab(kind) {
      activeCodeTab = kind;
      for (const tab of codeTabs) {
        const active = tab.dataset.codeTab === kind;
        tab.className = active
          ? "code-tab border border-line bg-ink px-3 py-2 font-mono text-xs text-paper"
          : "code-tab border border-line px-3 py-2 font-mono text-xs text-ink hover:bg-ink hover:text-paper";
      }
      updateRequestExamples();
    }

    async function copyText(text) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    for (const tab of codeTabs) {
      tab.addEventListener("click", () => selectCodeTab(tab.dataset.codeTab));
    }

    languageToggle.addEventListener("click", switchLanguage);

    copyRequestCode.addEventListener("click", async () => {
      await copyText(requestCode.textContent || "");
      copyRequestCode.setAttribute("aria-label", copy.copiedRequestExample);
      copyRequestCode.setAttribute("title", copy.copiedRequestExample);
      copyRequestCode.classList.add("bg-[#d8f3dc]", "text-[#111111]");
      setTimeout(() => {
        copyRequestCode.setAttribute("aria-label", copy.copyRequestExample);
        copyRequestCode.setAttribute("title", copy.copyRequestExample);
        copyRequestCode.classList.remove("bg-[#d8f3dc]", "text-[#111111]");
      }, 1200);
    });

    copyJsonOutput.addEventListener("click", async () => {
      await copyText(output.textContent || "");
      copyJsonOutput.setAttribute("aria-label", copy.copiedJsonResponse);
      copyJsonOutput.setAttribute("title", copy.copiedJsonResponse);
      copyJsonOutput.classList.add("bg-[#d8f3dc]", "text-[#111111]");
      setTimeout(() => {
        copyJsonOutput.setAttribute("aria-label", copy.copyJsonResponse);
        copyJsonOutput.setAttribute("title", copy.copyJsonResponse);
        copyJsonOutput.classList.remove("bg-[#d8f3dc]", "text-[#111111]");
      }, 1200);
    });

    closeDrawer.addEventListener("click", () => {
      workspace.classList.remove("max-w-[1600px]");
      workspace.classList.remove("grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", "gap-10");
      workspace.classList.add("max-w-[760px]", "grid-cols-[minmax(0,1fr)_0fr]", "gap-0");
      topNav.classList.remove("max-w-[1600px]");
      topNav.classList.add("max-w-[760px]");
      drawer.classList.remove("opacity-100");
      drawer.classList.add("opacity-0");
    });

    function openDrawer() {
      workspace.classList.remove("max-w-[760px]");
      workspace.classList.remove("grid-cols-[minmax(0,1fr)_0fr]", "gap-0");
      workspace.classList.add("max-w-[1600px]", "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", "gap-10");
      topNav.classList.remove("max-w-[760px]");
      topNav.classList.add("max-w-[1600px]");
      window.requestAnimationFrame(() => {
        drawer.classList.remove("opacity-0");
        drawer.classList.add("opacity-100");
      });
    }

    async function pollQuery(job) {
      let current = job;
      while (current && (current.status === "queued" || current.status === "running")) {
        setStatus("warn", copy.pollingStatus + " " + current.status);
        setMeta(current);
        output.textContent = JSON.stringify(current, null, 2);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const response = await fetch(current.pollUrl);
        current = await response.json();
      }
      return current;
    }

    applyI18n();
    setStatus("ready", copy.readyStatus);

    form.addEventListener("input", () => {
      updateRequestExamples();
    });

    updateRequestExamples();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const url = buildUrl();
      updateRequestExamples();
      openDrawer();
      button.disabled = true;
      button.textContent = copy.fetchingButton;
      setStatus("warn", copy.requestingStatus);
      startLoadingAnimation();
      try {
        const response = await fetch(url);
        let data = await response.json();
        if (response.ok && data.pollUrl) {
          stopLoadingAnimation();
          setStatus("warn", copy.submittedStatus);
          setMeta(data);
          output.textContent = JSON.stringify(data, null, 2);
          data = await pollQuery(data);
        }
        stopLoadingAnimation();
        setResultMeta(data);
        output.textContent = JSON.stringify(data, null, 2);
        setStatus(
          response.ok && data.status !== "failed" ? "ok" : "error",
          response.ok && data.status !== "failed" ? copy.completeStatus : copy.failedStatus,
        );
      } catch (error) {
        stopLoadingAnimation();
        const message = error instanceof Error ? error.message : String(error);
        setStatus("error", copy.failedStatus);
        output.textContent = JSON.stringify({ status: "error", message }, null, 2);
      } finally {
        button.disabled = false;
        button.textContent = copy.fetchButton;
      }
    });
  </script>
</body>
</html>`;
}
