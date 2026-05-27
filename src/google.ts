import { launchPersistentContext } from "cloakbrowser";
import {
  assertLoginWindowOpen,
  assertBrowserSessionAlive,
  closeContextSafely,
  evaluateWithNavigationRetry,
  hasOpenPages,
  installBrowserSessionBridge,
  installContextStatusOverlay,
  isTargetClosedError,
  keepContextOpenUntilExit,
  loginWindowClosedMessage,
  setContextStatus,
  setPageStatus,
} from "./browser-utils.js";
import { DEFAULT_GOOGLE_TRENDS_URL } from "./config.js";
import { runtimeInfo } from "./logger.js";
import { defaultOverviewRow } from "./overview.js";
import { clearSessionMarker, hasVerifiedSessionMarker, markSessionVerified } from "./session-marker.js";
import type {
  BrowserContextLike,
  CollectOutput,
  KeywordTrend,
  Options,
  OverviewRow,
  PageLike,
  RelatedQueries,
  ResponseLike,
  SearchIndexResponse,
} from "./types.js";

type GoogleExploreResponse = {
  widgets?: GoogleWidget[];
};

type GoogleWidget = {
  id?: string;
  token?: string;
  request?: unknown;
};

type GoogleTimelineResponse = {
  default?: {
    timelineData?: GoogleTimelineItem[];
  };
};

type GoogleTimelineItem = {
  time: string;
  formattedTime?: string;
  value?: number[];
  hasData?: boolean[];
};

type GoogleRelatedSearchesResponse = {
  default?: {
    rankedList?: GoogleRankedList[];
  };
};

type GooglePageCapture = {
  timelines: { url: string; response: GoogleTimelineResponse }[];
  related: GoogleRelatedSearchesResponse[];
};

const GOOGLE_PAGE_CAPTURE_WAIT_MS = 1_500;
const GOOGLE_RELATED_FALLBACK_TIMEOUT_MS = 8_000;

type GoogleRankedList = {
  rankedKeyword?: GoogleRankedKeyword[];
};

type GoogleRankedKeyword = {
  query?: string;
  topic?: {
    title?: string;
  };
  value?: number;
  formattedValue?: string;
  link?: string;
};

export async function verifyGoogleLogin(options: Pick<Options, "profileDir" | "timeoutMs" | "words" | "range" | "geo">): Promise<boolean> {
  const browser = await launchPersistentContext({
    userDataDir: googleProfileDirFor(options as Options),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezone: "America/Los_Angeles",
    humanize: true,
    humanPreset: "careful",
  });

  try {
    const page = await browser.newPage();
    const returnUrl = googleLoginCheckUrl();
    await page.goto(returnUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForSelector("body", { timeout: options.timeoutMs });
    const verified = await hasValidGoogleLogin(browser, page);
    if (verified) await markSessionVerified(options.profileDir, "google");
    else await clearSessionMarker(options.profileDir);
    return verified;
  } finally {
    await closeContextSafely(browser);
  }
}

export async function loginGoogle(options: Options): Promise<void> {
  await loginGoogleAttempt(options, 0);
}

async function loginGoogleAttempt(options: Options, retryCount: number): Promise<void> {
  emitStatus(options, "正在准备 Google 登录...");
  const browser = await launchPersistentContext({
    userDataDir: googleProfileDirFor(options),
    headless: false,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezone: "America/Los_Angeles",
    humanize: true,
    humanPreset: "careful",
  });
  contextStatusHandlers.set(browser, (message) => emitStatus(options, message));
  if (options.quietStatus) contextQuietStatus.add(browser);
  await installBrowserSessionBridge(browser);
  await installContextStatusOverlay(browser, true, "正在准备 Google 登录...");
  let retrying = false;

  try {
    const page = await browser.newPage();
    const returnUrl = googleLoginCheckUrl();
    emitStatus(options, "正在打开 Google Trends 登录页...");
    await setPageStatus(page, true, "正在打开 Google Trends 登录页...");
    await page.goto(returnUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForSelector("body", { timeout: options.timeoutMs });
    emitStatus(options, "正在检查 Google 登录状态...");
    await setPageStatus(page, true, "正在检查 Google 登录状态...");
    if (await hasValidGoogleLogin(browser, page)) {
      await markSessionVerified(googleProfileDirFor(options), "google");
      logStatus(options, "Google 登录状态已就绪。");
      emitStatus(options, "Google 登录状态已就绪。");
      await setPageStatus(page, true, "Google 登录状态已就绪。");
      return;
    }

    const loginUrl = new URL("https://accounts.google.com/ServiceLogin");
    loginUrl.searchParams.set("continue", returnUrl);
    emitStatus(options, "正在打开 Google 登录页...");
    await setPageStatus(page, true, "正在打开 Google 登录页...");
    await page.goto(loginUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    logStatus(options, "请在打开的浏览器里登录 Google...");
    emitStatus(options, "请在打开的浏览器里登录 Google...");
    await waitForGoogleLogin(browser, page, options.loginTimeoutMs, true);
    await markSessionVerified(googleProfileDirFor(options), "google");
  } catch (error) {
    if (retryCount < 1 && isGoogleLoginInterruptedError(error)) {
      retrying = true;
      runtimeInfo("Google 登录窗口已关闭，正在重新打开登录窗口...");
      emitStatus(options, "Google 登录窗口已关闭，正在重新打开登录窗口...");
      await closeContextSafely(browser);
      return await loginGoogleAttempt(options, retryCount + 1);
    }
    throw error;
  } finally {
    if (retrying) {
      // The closed login window has already been cleaned up before retrying.
    } else if (options.keepOpen && !options.headless && hasOpenPages(browser)) {
      keepContextOpenUntilExit(browser, "已设置 --keep-open true，保留 Google 浏览器窗口。");
    } else {
      await closeContextSafely(browser);
    }
  }
}

export async function collectGoogleTrends(options: Options): Promise<CollectOutput> {
  const googleProfileDir = googleProfileDirFor(options);
  if (options.headless && !hasGoogleLoginInProfile(googleProfileDir)) {
    runtimeInfo("未检测到 Google 登录状态，正在打开可视浏览器用于手动登录...");
    return collectGoogleTrends({ ...options, headless: false });
  }

  const t0 = Date.now();
  const trace = process.env.OHMYTRENDS_GOOGLE_TIMING === "true";
  const tick = (label: string) => { if (trace) runtimeInfo(`[google-timing ${(Date.now() - t0).toString().padStart(5)}ms] ${label}`); };

  tick("launch start");
  const browser = await launchPersistentContext({
    userDataDir: googleProfileDir,
    headless: options.headless,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezone: "America/Los_Angeles",
    humanize: true,
    humanPreset: "careful",
  });
  tick("launch done");
  await installContextStatusOverlay(browser, !options.headless, "正在启动 Google Trends 采集...");
  tick("overlay installed");

  try {
    const page = await browser.newPage();
    tick("page created");
    const sourceUrl = googleExplorePageUrl(options);
    await setPageStatus(page, !options.headless, "正在打开 Google Trends...");
    // Page mode navigates to sourceUrl itself and captures responses from that
    // very navigation, so we skip the prefatory login-check goto. API mode
    // still benefits from landing on a Trends URL up front for cookie warmup.
    if (options.googleMode !== "page") {
      await page.goto(googleLoginCheckUrl(), {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      tick("initial goto done (login check)");
    } else {
      tick("initial goto skipped (page mode)");
    }
    await page.waitForSelector("body", { timeout: options.timeoutMs });
    tick("body ready");
    if (options.headless && !await hasValidGoogleLogin(browser, page)) {
      await clearSessionMarker(googleProfileDir);
      runtimeInfo("Google 登录状态无效，正在打开可视浏览器用于重新登录...");
      await closeContextSafely(browser);
      return collectGoogleTrends({ ...options, headless: false });
    }
    tick("login verified");
    await ensureGoogleLoggedIn(browser, page, options, sourceUrl);
    await setPageStatus(page, !options.headless, "正在采集 Google 趋势数据...");
    if (options.googleMode === "page") {
      const result = await collectGoogleTrendsWithApiFallback(page, options, sourceUrl);
      tick(`collect done (page) status=${result.status}`);
      return result;
    }
    const result = await collectGoogleTrendsViaApiMode(page, options, sourceUrl);
    tick(`collect done (api) status=${result.status}`);
    return result;
  } finally {
    if (options.keepOpen && !options.headless && hasOpenPages(browser)) {
      keepContextOpenUntilExit(browser, "已设置 --keep-open true，保留 Google 浏览器窗口。");
    } else {
      await closeContextSafely(browser);
    }
  }
}

export function hasGoogleLoginInProfile(profileDir: string): boolean {
  return hasVerifiedSessionMarker(profileDir, "google");
}

function googleProfileDirFor(options: Options): string {
  return options.profileDir;
}

async function ensureGoogleLoggedIn(
  context: BrowserContextLike,
  page: PageLike,
  options: Options,
  returnUrl: string,
): Promise<void> {
  const profileDir = googleProfileDirFor(options);
  if (await hasValidGoogleLogin(context, page)) {
    await markSessionVerified(profileDir, "google");
    return;
  }
  await clearSessionMarker(profileDir);

  runtimeInfo(`Google 账号未登录，请在打开的浏览器中完成登录；最多等待 ${Math.round(options.loginTimeoutMs / 60_000)} 分钟...`);
  const loginUrl = new URL("https://accounts.google.com/ServiceLogin");
  loginUrl.searchParams.set("continue", returnUrl);
  await setPageStatus(page, !options.headless, "正在打开 Google 登录页...");
  await page.goto(loginUrl.toString(), {
    waitUntil: "domcontentloaded",
    timeout: options.timeoutMs,
  });
  await waitForGoogleLogin(context, page, options.loginTimeoutMs, !options.headless);
  await setPageStatus(page, !options.headless, "已检测到 Google 登录，正在返回 Trends...");
  await page.goto(returnUrl, {
    waitUntil: "domcontentloaded",
    timeout: options.timeoutMs,
  });
  await page.waitForSelector("body", { timeout: options.timeoutMs });
  if (!await hasValidGoogleLogin(context, page)) {
    await clearSessionMarker(profileDir);
    throw new Error("Google 登录验证失败：返回 Trends 后仍未检测到有效登录，请重新发起登录。");
  }
  await markSessionVerified(profileDir, "google");
}

async function waitForGoogleLogin(
  context: BrowserContextLike,
  page: PageLike,
  timeoutMs: number,
  showStatus = false,
): Promise<void> {
  const startedAt = Date.now();
  let lastNoticeAt = 0;
  let activePage = page;
  while (Date.now() - startedAt < timeoutMs) {
    assertBrowserSessionAlive(context, "Google");
    activePage = selectActiveGoogleLoginPage(context, activePage);
    try {
      if (await hasValidGoogleLogin(context, activePage)) {
        logContextStatus(context, "已检测到 Google 登录，继续执行任务...");
        emitStatusFromContext(context, "已检测到 Google 登录，继续执行任务...");
        await setContextStatus(context, showStatus, "已检测到 Google 登录，继续执行任务...");
        return;
      }
    } catch (error) {
      if (isGoogleLoginInterruptedError(error)) throw new Error(loginWindowClosedMessage("Google"));
      throw error;
    }

    if (Date.now() - lastNoticeAt > 10_000) {
      const remainingSeconds = Math.max(0, Math.ceil((timeoutMs - (Date.now() - startedAt)) / 1000));
      logContextStatus(context, `等待 Google 登录中，剩余 ${remainingSeconds} 秒`);
      emitStatusFromContext(context, `等待 Google 登录中，剩余 ${remainingSeconds} 秒`);
      await setContextStatus(context, showStatus, `等待 Google 登录中，剩余 ${remainingSeconds} 秒`);
      lastNoticeAt = Date.now();
    }

    try {
      await activePage.waitForTimeout(1_000);
    } catch (error) {
      if (isGoogleLoginInterruptedError(error)) throw new Error(loginWindowClosedMessage("Google"));
      throw error;
    }
  }

  throw new Error("等待 Google 登录超时；请在打开的浏览器中完成登录后重新运行");
}

export function selectActiveGoogleLoginPage(context: BrowserContextLike, fallback: PageLike): PageLike {
  try {
    const openPages = context.pages().filter((candidate) => !candidate.isClosed?.());
    const preferred = openPages.find((candidate) => /accounts\.google\.com|trends\.google\.com/.test(safePageUrl(candidate)))
      || (!fallback.isClosed?.() ? fallback : undefined);
    if (preferred) return preferred;
  } catch {
    // Fall through to the existing closed-window error.
  }
  throw new Error(loginWindowClosedMessage("Google"));
}

function safePageUrl(page: PageLike): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function isLoginWindowClosedError(error: unknown, service: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === loginWindowClosedMessage(service);
}

function isGoogleLoginInterruptedError(error: unknown): boolean {
  if (isLoginWindowClosedError(error, "Google") || isTargetClosedError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /net::ERR_ABORTED|frame was detached|Navigation failed because page was closed/i.test(message);
}

const contextStatusHandlers = new WeakMap<BrowserContextLike, (message: string) => void>();
const contextQuietStatus = new WeakSet<BrowserContextLike>();

function emitStatus(options: Options, message: string): void {
  options.onStatus?.(message);
}

function logStatus(options: Options, message: string): void {
  if (!options.quietStatus) runtimeInfo(message);
}

function emitStatusFromContext(context: BrowserContextLike, message: string): void {
  contextStatusHandlers.get(context)?.(message);
}

function logContextStatus(context: BrowserContextLike, message: string): void {
  if (!contextQuietStatus.has(context)) runtimeInfo(message);
}

async function hasGoogleLoginCookie(context: BrowserContextLike): Promise<boolean> {
  const cookies = await context.cookies([
    "https://www.google.com",
    "https://trends.google.com",
    "https://accounts.google.com",
  ]);
  return cookies.some((cookie) =>
    ["SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"].includes(cookie.name) &&
    cookie.value.length > 0,
  );
}

async function hasValidGoogleLogin(context: BrowserContextLike, page: PageLike): Promise<boolean> {
  return await hasGoogleLoginCookie(context) && !await isGoogleLoginPrompt(page);
}

async function isGoogleLoginPrompt(page: PageLike): Promise<boolean> {
  try {
    const url = page.url();
    if (url.includes("accounts.google.com")) return true;
    const text = await page.locator("body").innerText({ timeout: 2_000 });
    return /Sign in|Use your Google Account|Email or phone|Not your computer|登录|使用您的 Google 账号|邮箱或电话号码|忘记了邮箱|您用的不是自己的电脑|创建账号/.test(text);
  } catch (error) {
    if (isTargetClosedError(error)) throw error;
    return false;
  }
}

async function collectGoogleTrendsWithApiFallback(
  page: PageLike,
  options: Options,
  sourceUrl: string,
): Promise<CollectOutput> {
  let pageResult: CollectOutput | undefined;
  let pageError: unknown;
  try {
    pageResult = await collectGoogleTrendsViaPageMode(page, options, sourceUrl);
    if (pageResult.status === "ok") return pageResult;
    runtimeInfo(`Google page 模式数据不完整（${pageResult.reason || "no_data"}），尝试 API 模式兜底...`);
  } catch (error) {
    pageError = error;
    runtimeInfo(
      `Google page 模式失败：${error instanceof Error ? error.message : String(error)}，尝试 API 模式兜底...`,
    );
  }

  try {
    const apiResult = await collectGoogleTrendsViaApiMode(page, options, sourceUrl);
    if (apiResult.status === "ok") return apiResult;
    // Both empty — surface the API result; it has consistent metadata even
    // when no data is available.
    return apiResult;
  } catch (apiError) {
    if (pageResult) {
      runtimeInfo(
        `Google API 兜底也失败：${apiError instanceof Error ? apiError.message : String(apiError)}；返回 page 模式的 no_data 结果。`,
      );
      return pageResult;
    }
    if (pageError) {
      runtimeInfo(
        `Google API 兜底也失败：${apiError instanceof Error ? apiError.message : String(apiError)}`,
      );
    }
    throw apiError;
  }
}

async function collectGoogleTrendsViaPageMode(
  page: PageLike,
  options: Options,
  sourceUrl: string,
): Promise<CollectOutput> {
  if (!page.waitForResponse) {
    throw new Error("Google page mode requires waitForResponse support");
  }
  const captured: GooglePageCapture = { timelines: [], related: [] };
  const captureTasks = new Set<Promise<void>>();
  page.on("response", (response: ResponseLike) => {
    queueGooglePageResponseCapture(response, captured, captureTasks);
  });

  // Arm the multiline waiter BEFORE navigation so we never miss the response.
  // Use the full request timeout — Google occasionally takes 5-10s to fire the
  // multiline call on a cold session.
  const multilineWaiter = page.waitForResponse(
    (resp) => googlePageResponseKindFromUrl(resp.url()) === "timeline",
    { timeout: options.timeoutMs },
  ).catch(() => undefined);

  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

  // Wait for the timeline response specifically. Avoids the multi-second
  // `networkidle` wait — Google Trends fires periodic analytics calls that
  // keep the network "busy" long after the data we need is in hand.
  const directMultiline = await multilineWaiter;
  // Poll briefly for the relatedsearches responses that fire alongside the
  // timeline. Exit as soon as we have one per keyword.
  const relatedDeadline = Date.now() + GOOGLE_PAGE_CAPTURE_WAIT_MS;
  while (Date.now() < relatedDeadline) {
    await page.waitForTimeout(120);
    await flushGooglePageResponseCaptures(captureTasks);
    if (captured.related.length >= options.words.length) break;
  }
  await flushGooglePageResponseCaptures(captureTasks);

  if (captured.timelines.length === 0 && directMultiline) {
    const response = await readGoogleJsonResponse<GoogleTimelineResponse>(directMultiline);
    if (response) captured.timelines.push({ url: directMultiline.url(), response });
  }

  const timelineCapture = selectGoogleTimelineCapture(captured.timelines, options.words);
  if (!timelineCapture || !googleTimelineHasDataForWords(timelineCapture.response, options.words)) {
    return googleNoDataOutput(
      options,
      sourceUrl,
      timelineCapture?.url || sourceUrl,
      "Google page mode timeline data is empty",
      timelineCapture?.response,
    );
  }

  const timeline = timelineCapture.response;
  const points = timeline.default?.timelineData || [];
  const trends = googleTimelineToTrends(options.words, points);
  const overview = googleOverviewFromTrends(options.words, trends);

  const relatedQueries = captured.related.length > 0
    ? mergeRelatedFromResponses(options.words, captured.related)
    : await collectRelatedQueriesWithTimeout(page, options);

  const ok = trends.some((trend) => trend.points.some((point) => point.all !== null));
  const relatedCount = Object.values(relatedQueries)
    .reduce((sum, item) => sum + item.top.length + item.rising.length, 0);
  await setPageStatus(
    page,
    !options.headless,
    `Google 采集完成（page 模式）：趋势点 ${points.length} 个，相关查询 ${relatedCount} 条。`,
  );

  return {
    capturedAt: new Date().toISOString(),
    source: "google",
    sourceUrl,
    apiUrl: redactGoogleApiUrl(timelineCapture.url),
    words: options.words,
    status: ok ? "ok" : "no_data",
    reason: ok ? undefined : "Google Trends returned no timeline data",
    overview,
    trends,
    relatedQueries,
    raw: options.raw ? timeline as unknown as SearchIndexResponse : undefined,
    error: ok ? undefined : "Google Trends returned no timeline data",
  };
}

function queueGooglePageResponseCapture(
  response: ResponseLike,
  captured: GooglePageCapture,
  tasks: Set<Promise<void>>,
): void {
  const kind = googlePageResponseKindFromUrl(response.url());
  if (!kind) return;
  const task = readGoogleJsonResponse<GoogleTimelineResponse | GoogleRelatedSearchesResponse>(response)
    .then((json) => {
      if (!json) return;
      if (kind === "timeline") {
        captured.timelines.push({ url: response.url(), response: json as GoogleTimelineResponse });
      } else {
        captured.related.push(json as GoogleRelatedSearchesResponse);
      }
    });
  tasks.add(task);
  task.finally(() => tasks.delete(task));
}

function googlePageResponseKindFromUrl(url: string): "timeline" | "related" | undefined {
  if (/\/trends\/api\/widgetdata\/multiline/.test(url)) return "timeline";
  if (/\/trends\/api\/widgetdata\/relatedsearches/.test(url)) return "related";
  return undefined;
}

async function flushGooglePageResponseCaptures(tasks: Set<Promise<void>>): Promise<void> {
  if (tasks.size === 0) return;
  await Promise.allSettled([...tasks]);
}

async function readGoogleJsonResponse<T>(response: ResponseLike): Promise<T | undefined> {
  try {
    if (typeof response.text === "function") {
      return JSON.parse(stripGoogleJsonPrefix(await response.text())) as T;
    }
    return await response.json() as T;
  } catch {
    return undefined;
  }
}

export function selectGoogleTimelineCapture(
  captures: { url: string; response: GoogleTimelineResponse }[],
  words: string[],
): { url: string; response: GoogleTimelineResponse } | undefined {
  return captures.find((capture) => googleTimelineHasDataForWords(capture.response, words));
}

function googleTimelineHasDataForWords(response: GoogleTimelineResponse, words: string[]): boolean {
  const points = response.default?.timelineData || [];
  return points.some((point) =>
    Array.isArray(point.value) &&
    point.value.length >= words.length &&
    point.value.some((value) => Number.isFinite(value))
  );
}

function mergeRelatedFromResponses(
  words: string[],
  responses: GoogleRelatedSearchesResponse[],
): Record<string, RelatedQueries> {
  const merged: Record<string, RelatedQueries> = {};
  for (const word of words) merged[word] = { top: [], rising: [] };
  // The page typically fires one relatedsearches request per keyword group; we
  // cannot reliably map response → keyword without inspecting the request body,
  // so we surface the first non-empty result as a shared fallback.
  for (const response of responses) {
    const queries = googleRelatedQueriesFromResponse(response);
    for (const word of words) {
      if (merged[word].top.length === 0 && queries.top.length > 0) merged[word].top = queries.top;
      if (merged[word].rising.length === 0 && queries.rising.length > 0) merged[word].rising = queries.rising;
    }
  }
  return merged;
}

async function collectGoogleTrendsViaApiMode(
  page: PageLike,
  options: Options,
  sourceUrl: string,
): Promise<CollectOutput> {
  const exploreReq = googleExploreRequest(options, options.words);
  const exploreUrl = new URL("https://trends.google.com/trends/api/explore");
  exploreUrl.searchParams.set("hl", "en-US");
  exploreUrl.searchParams.set("tz", String(googleTimezoneOffsetMinutes()));
  exploreUrl.searchParams.set("req", JSON.stringify(exploreReq));

  const explore = await fetchGoogleJsonInPage<GoogleExploreResponse>(page, exploreUrl.toString());
  const widget = (explore.widgets || []).find((item) => item.id === "TIMESERIES");
  if (!widget?.token || !widget.request) {
    return googleNoDataOutput(options, sourceUrl, exploreUrl.toString(), "Google Trends timeseries widget not found", explore);
  }

  const timelineUrl = new URL("https://trends.google.com/trends/api/widgetdata/multiline");
  timelineUrl.searchParams.set("hl", "en-US");
  timelineUrl.searchParams.set("tz", String(googleTimezoneOffsetMinutes()));
  timelineUrl.searchParams.set("req", JSON.stringify(widget.request));
  timelineUrl.searchParams.set("token", widget.token);

  let timeline = await fetchGoogleJsonInPage<GoogleTimelineResponse>(page, timelineUrl.toString());
  if (!googleTimelineHasDataForWords(timeline, options.words)) {
    // Google occasionally returns HTTP 200 with all `hasData=false` for a fresh
    // headless context. A short delay + one retry usually unblocks it.
    await page.waitForTimeout(2_500);
    const retried = await fetchGoogleJsonInPage<GoogleTimelineResponse>(page, timelineUrl.toString()).catch(() => undefined);
    if (retried && googleTimelineHasDataForWords(retried, options.words)) {
      timeline = retried;
    }
  }
  const points = timeline.default?.timelineData || [];
  const trends = googleTimelineToTrends(options.words, points);
  const overview = googleOverviewFromTrends(options.words, trends);
  const relatedQueries = await collectRelatedQueries(page, options);
  const ok = trends.some((trend) => trend.points.some((point) => point.all !== null));
  const relatedCount = Object.values(relatedQueries)
    .reduce((sum, item) => sum + item.top.length + item.rising.length, 0);
  await setPageStatus(
    page,
    !options.headless,
    `Google 采集完成：趋势点 ${points.length} 个，相关查询 ${relatedCount} 条。`,
  );

  return {
    capturedAt: new Date().toISOString(),
    source: "google",
    sourceUrl,
    apiUrl: redactGoogleApiUrl(timelineUrl.toString()),
    words: options.words,
    status: ok ? "ok" : "no_data",
    reason: ok ? undefined : "Google Trends returned no timeline data",
    overview,
    trends,
    relatedQueries,
    raw: options.raw ? timeline as unknown as SearchIndexResponse : undefined,
    error: ok ? undefined : "Google Trends returned no timeline data",
  };
}

async function collectRelatedQueries(
  page: PageLike,
  options: Options,
): Promise<Record<string, RelatedQueries>> {
  const result: Record<string, RelatedQueries> = {};
  for (const [index, word] of options.words.entries()) {
    try {
      if (index > 0) await page.waitForTimeout(450);
      result[word] = await collectRelatedQueriesForWord(page, options, word);
    } catch {
      result[word] = { top: [], rising: [] };
    }
  }
  return result;
}

async function collectRelatedQueriesWithTimeout(
  page: PageLike,
  options: Options,
): Promise<Record<string, RelatedQueries>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      collectRelatedQueries(page, options),
      new Promise<Record<string, RelatedQueries>>((resolve) => {
        timeout = setTimeout(() => {
          resolve(emptyRelatedQueriesForWords(options.words));
        }, Math.min(options.timeoutMs, GOOGLE_RELATED_FALLBACK_TIMEOUT_MS));
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function emptyRelatedQueriesForWords(words: string[]): Record<string, RelatedQueries> {
  const result: Record<string, RelatedQueries> = {};
  for (const word of words) result[word] = { top: [], rising: [] };
  return result;
}

async function collectRelatedQueriesForWord(
  page: PageLike,
  options: Options,
  word: string,
): Promise<RelatedQueries> {
  const exploreUrl = new URL("https://trends.google.com/trends/api/explore");
  exploreUrl.searchParams.set("hl", "en-US");
  exploreUrl.searchParams.set("tz", String(googleTimezoneOffsetMinutes()));
  exploreUrl.searchParams.set("req", JSON.stringify(googleExploreRequest(options, [word])));

  const explore = await fetchGoogleJsonInPage<GoogleExploreResponse>(page, exploreUrl.toString());
  const widget = findGoogleWidget(explore.widgets || [], "RELATED_QUERIES");
  if (!widget?.token || !widget.request) {
    return { top: [], rising: [] };
  }

  const relatedUrl = new URL("https://trends.google.com/trends/api/widgetdata/relatedsearches");
  relatedUrl.searchParams.set("hl", "en-US");
  relatedUrl.searchParams.set("tz", String(googleTimezoneOffsetMinutes()));
  relatedUrl.searchParams.set("req", JSON.stringify(widget.request));
  relatedUrl.searchParams.set("token", widget.token);
  const related = await fetchGoogleJsonInPage<GoogleRelatedSearchesResponse>(page, relatedUrl.toString());
  return googleRelatedQueriesFromResponse(related);
}

export function findGoogleWidget(widgets: GoogleWidget[], id: string): GoogleWidget | undefined {
  return widgets.find((item) => item.id === id || item.id?.startsWith(`${id}_`));
}

function googleExploreRequest(options: Options, words: string[]) {
  return {
    comparisonItem: words.map((keyword) => ({
      keyword,
      geo: options.geo,
      time: googleTimeRange(options),
    })),
    category: 0,
    property: "",
  };
}

export function googleRelatedQueriesFromResponse(response: GoogleRelatedSearchesResponse): RelatedQueries {
  const lists = response.default?.rankedList || [];
  return {
    top: rankedKeywordsToRelatedQueries(lists[0]?.rankedKeyword || []),
    rising: rankedKeywordsToRelatedQueries(lists[1]?.rankedKeyword || []),
  };
}

function rankedKeywordsToRelatedQueries(items: GoogleRankedKeyword[]) {
  return items.map((item) => ({
    query: item.query || item.topic?.title || "",
    value: Number.isFinite(item.value) ? Number(item.value) : null,
    formattedValue: item.formattedValue || (Number.isFinite(item.value) ? String(item.value) : ""),
    link: item.link,
  })).filter((item) => item.query);
}

async function fetchGoogleJsonInPage<T>(page: PageLike, url: string): Promise<T> {
  const retryDelays = [2_000, 5_000, 10_000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const text = await page.evaluate(async (requestUrl) => {
        const response = await fetch(requestUrl, {
          credentials: "include",
          headers: {
            "accept": "application/json, text/plain, */*",
          },
        });
        if (!response.ok) {
          throw new Error(`Google Trends request failed: ${response.status} ${response.statusText}`);
        }
        return response.text();
      }, url);
      return JSON.parse(stripGoogleJsonPrefix(text)) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= retryDelays.length || !isRetryableGoogleRequestError(error)) break;
      await page.waitForTimeout(retryDelays[attempt] || 1_000);
    }
  }
  throw lastError;
}

function isRetryableGoogleRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Google Trends request failed: (429|500|502|503|504)\b/.test(message);
}

export function stripGoogleJsonPrefix(text: string): string {
  return text.replace(/^\)\]\}',?\s*/, "");
}

export function googleTimelineToTrends(words: string[], timeline: GoogleTimelineItem[]): KeywordTrend[] {
  return words.map((word, wordIndex) => ({
    word,
    points: timeline.map((item) => {
      const value = item.value?.[wordIndex];
      const hasData = item.hasData?.[wordIndex] ?? value !== undefined;
      return {
        date: googleTimelineDate(item),
        all: hasData && Number.isFinite(value) ? Number(value) : null,
        pc: null,
        wise: null,
      };
    }),
  }));
}

function googleTimelineDate(item: GoogleTimelineItem): string {
  const seconds = Number(item.time);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }
  return item.formattedTime || "";
}

export function googleOverviewFromTrends(words: string[], trends: KeywordTrend[]): OverviewRow[] {
  return words.map((word) => {
    const trend = trends.find((item) => item.word === word);
    const values = trend?.points
      .map((point) => point.all)
      .filter((value): value is number => value !== null) || [];
    const average = values.length > 0
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
    return {
      keyword: word,
      overallDailyAverage: average,
      mobileDailyAverage: null,
      overallYearOverYear: null,
      overallMonthOverMonth: null,
      mobileYearOverYear: null,
      mobileMonthOverMonth: null,
    };
  });
}

function googleNoDataOutput(
  options: Options,
  sourceUrl: string,
  apiUrl: string,
  reason: string,
  raw?: unknown,
): CollectOutput {
  return {
    capturedAt: new Date().toISOString(),
    source: "google",
    sourceUrl,
    apiUrl: redactGoogleApiUrl(apiUrl),
    words: options.words,
    status: "no_data",
    reason,
    overview: options.words.map(defaultOverviewRow),
    trends: [],
    raw: options.raw ? raw as SearchIndexResponse : undefined,
    error: reason,
  };
}

export function googleExplorePageUrl(options: Options): string {
  const url = new URL(DEFAULT_GOOGLE_TRENDS_URL);
  url.searchParams.set("date", googleTimeRange(options));
  if (options.words.length > 0) {
    url.searchParams.set("q", options.words.join(","));
  }
  if (options.geo) url.searchParams.set("geo", options.geo);
  return url.toString();
}

export function googleLoginCheckUrl(): string {
  return "https://trends.google.com/trends";
}

function googleTimeRange(options: Options): string {
  if (options.range) return options.range;
  return options.startDate && options.endDate
    ? `${options.startDate} ${options.endDate}`
    : "today 1-m";
}

export function redactGoogleApiUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "[redacted]");
    }
    return url.toString();
  } catch {
    return value.replace(/([?&]token=)[^&]+/g, "$1[redacted]");
  }
}

function googleTimezoneOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}
