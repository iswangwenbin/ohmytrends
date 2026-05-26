import { launchPersistentContext } from "cloakbrowser";
import {
  assertLoginWindowOpen,
  assertBrowserSessionAlive,
  closeContextSafely,
  evaluateWithNavigationRetry,
  hasCookieInProfile,
  hasOpenPages,
  installBrowserSessionBridge,
  installContextStatusOverlay,
  isTargetClosedError,
  keepContextOpenUntilExit,
  loginWindowClosedMessage,
  setContextStatus,
  setPageStatus,
  waitForPageSettled,
} from "./browser-utils.js";
import { DEFAULT_GOOGLE_TRENDS_URL } from "./config.js";
import { runtimeInfo } from "./logger.js";
import { defaultOverviewRow } from "./overview.js";
import type {
  BrowserContextLike,
  CollectOutput,
  KeywordTrend,
  Options,
  OverviewRow,
  PageLike,
  RelatedQueries,
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
    const returnUrl = googleExplorePageUrl(options as Options);
    await page.goto(returnUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForSelector("body", { timeout: options.timeoutMs });
    return await hasValidGoogleLogin(browser, page);
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
    const returnUrl = googleExplorePageUrl(options);
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

  const browser = await launchPersistentContext({
    userDataDir: googleProfileDir,
    headless: options.headless,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezone: "America/Los_Angeles",
    humanize: true,
    humanPreset: "careful",
  });
  await installContextStatusOverlay(browser, !options.headless, "正在启动 Google Trends 采集...");

  try {
    const page = await browser.newPage();
    const sourceUrl = googleExplorePageUrl(options);
    await setPageStatus(page, !options.headless, "正在打开 Google Trends...");
    await page.goto(sourceUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForSelector("body", { timeout: options.timeoutMs });
    if (options.headless && !await hasValidGoogleLogin(browser, page)) {
      runtimeInfo("Google 登录状态无效，正在打开可视浏览器用于重新登录...");
      await closeContextSafely(browser);
      return collectGoogleTrends({ ...options, headless: false });
    }
    await ensureGoogleLoggedIn(browser, page, options, sourceUrl);
    await setPageStatus(page, !options.headless, "正在采集 Google 趋势数据...");
    return await collectGoogleTrendsFromPage(page, options, sourceUrl);
  } finally {
    if (options.keepOpen && !options.headless && hasOpenPages(browser)) {
      keepContextOpenUntilExit(browser, "已设置 --keep-open true，保留 Google 浏览器窗口。");
    } else {
      await closeContextSafely(browser);
    }
  }
}

export function hasGoogleLoginInProfile(profileDir: string): boolean {
  return hasCookieInProfile(profileDir, [
    "SID",
    "HSID",
    "SSID",
    "APISID",
    "SAPISID",
    "__Secure-1PSID",
    "__Secure-3PSID",
  ]);
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
  if (await hasValidGoogleLogin(context, page)) return;

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
    return /Sign in|Use your Google Account|Email or phone|登录|使用您的 Google 账号/.test(text);
  } catch (error) {
    if (isTargetClosedError(error)) throw error;
    return false;
  }
}

async function collectGoogleTrendsFromPage(
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

  const timeline = await fetchGoogleJsonInPage<GoogleTimelineResponse>(page, timelineUrl.toString());
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
  for (const word of options.words) {
    url.searchParams.append("q", word);
  }
  if (options.geo) url.searchParams.set("geo", options.geo);
  return url.toString();
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
