import { launchPersistentContext } from "cloakbrowser";
import {
  assertBrowserSessionAlive,
  assertLoginWindowOpen,
  closeContextSafely,
  evaluateWithNavigationRetry,
  hasCookieInProfile,
  hasOpenPages,
  installBrowserSessionBridge,
  installContextStatusOverlay,
  isTargetClosedError,
  keepContextOpenUntilExit,
  loginWindowClosedMessage,
  readJsonResponse,
  setBaiduLoginGuide,
  setContextStatus,
  setPageStatus,
  waitForPageSettled,
} from "./browser-utils.js";
import { buildBaiduTrendUrl, DEFAULT_HOME_URL } from "./config.js";
import { runtimeInfo, runtimeWarn } from "./logger.js";
import { defaultOverviewRow, hasOverviewData, overviewRowFromCells, zeroOverviewRow } from "./overview.js";
import type {
  BrowserContextLike,
  BaiduIndexKind,
  BaiduIndexSection,
  CollectOutput,
  KeywordTrend,
  Options,
  OverviewRow,
  PageLike,
  ResponseLike,
  RawFeedIndexGroup,
  RawIndexGroup,
  RawSearchIndexGroup,
  RawIndexSeries,
  RouteLike,
  SearchIndexResponse,
} from "./types.js";

export async function verifyBaiduLogin(options: Pick<Options, "profileDir" | "timeoutMs">): Promise<boolean> {
  const browser = await launchPersistentContext({
    userDataDir: options.profileDir,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    humanize: true,
    humanPreset: "careful",
  });

  try {
    const page = await browser.newPage();
    await page.goto(DEFAULT_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForSelector("body", { timeout: options.timeoutMs });
    await waitForBaiduHomeHydrated(page, options.timeoutMs);
    return await hasValidBaiduLogin(browser, page);
  } finally {
    await closeContextSafely(browser);
  }
}

export async function loginBaidu(options: Options): Promise<void> {
  emitStatus(options, "正在准备百度登录...");
  const browser = await launchPersistentContext({
    userDataDir: options.profileDir,
    headless: false,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    humanize: true,
    humanPreset: "careful",
  });
  contextStatusHandlers.set(browser, (message) => emitStatus(options, message));
  if (options.quietStatus) contextQuietStatus.add(browser);
  await installBrowserSessionBridge(browser);
  await installContextStatusOverlay(browser, true, "正在准备百度登录...");

  try {
    const page = await browser.newPage();
    emitStatus(options, "正在打开百度指数登录页...");
    await setPageStatus(page, true, "正在打开百度指数登录页...");
    await page.goto(DEFAULT_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForSelector("body", { timeout: options.timeoutMs });
    emitStatus(options, "正在检查百度登录状态...");
    await setPageStatus(page, true, "正在检查百度登录状态...");
    await waitForBaiduHomeHydrated(page, options.timeoutMs);
    if (await hasValidBaiduLogin(browser, page)) {
      logStatus(options, "百度登录状态已就绪。");
      emitStatus(options, "百度登录状态已就绪。");
      await setPageStatus(page, true, "百度登录状态已就绪。");
      return;
    }
    logStatus(options, "请在打开的浏览器里登录百度...");
    emitStatus(options, "请在打开的浏览器里登录百度...");
    await setBaiduLoginGuide(page, true);
    try {
      await waitForBaiduLogin(browser, page, options.loginTimeoutMs, true);
    } finally {
      await setBaiduLoginGuide(page, false);
    }
  } finally {
    if (options.keepOpen && !options.headless && hasOpenPages(browser)) {
      keepContextOpenUntilExit(browser, "已设置 --keep-open true，保留百度浏览器窗口。");
    } else {
      await closeContextSafely(browser);
    }
  }
}

export async function collectBaiduIndex(options: Options): Promise<CollectOutput> {
  if (options.headless && !hasBaiduLoginInProfile(options.profileDir)) {
    runtimeInfo("未检测到百度登录状态，正在打开可视浏览器用于手动登录...");
    return collectBaiduIndex({ ...options, headless: false });
  }

  const browser = await launchPersistentContext({
    userDataDir: options.profileDir,
    headless: options.headless,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    humanize: true,
    humanPreset: "careful",
  });
  await installContextStatusOverlay(browser, !options.headless, "正在启动百度指数采集...");

  const intercepted: Partial<Record<BaiduIndexKind, SearchIndexResponse[]>> = {
    search: [],
    feed: [],
  };
  const responseCaptureTasks = new Set<Promise<void>>();

  try {
    const page = await browser.newPage();
    await setPageStatus(page, !options.headless, "正在打开百度指数...");
    page.on("response", (response) => {
      queueBaiduResponseCapture(response, intercepted, responseCaptureTasks);
    });

    await page.goto(DEFAULT_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForSelector("body", { timeout: options.timeoutMs });
    await waitForBaiduHomeHydrated(page, options.timeoutMs);
    if (options.headless && !await hasValidBaiduLogin(browser, page)) {
      runtimeInfo("百度登录状态无效，正在打开可视浏览器用于重新登录...");
      await closeContextSafely(browser);
      return collectBaiduIndex({ ...options, headless: false });
    }
    await ensureLoggedIn(browser, page, options);

    const apiFirstOutput = options.baiduMode === "api"
      ? await tryCollectBaiduIndexFromApi(page, browser, options, intercepted)
      : undefined;
    if (apiFirstOutput) return apiFirstOutput;

    try {
      return await collectBaiduIndexViaPageMode(page, browser, options, intercepted, responseCaptureTasks);
    } catch (error) {
      if (options.baiduMode === "api") throw error;
      runtimeInfo(`百度 page 模式采集失败，回退到 api 模式：${error instanceof Error ? error.message : String(error)}`);
      await setPageStatus(page, !options.headless, "百度 page 模式采集失败，正在回退到接口采集...");
      const apiFallbackOutput = await tryCollectBaiduIndexFromApi(page, browser, options, intercepted);
      if (apiFallbackOutput) return apiFallbackOutput;
      throw error;
    }
  } finally {
    if (options.keepOpen && !options.headless && hasOpenPages(browser)) {
      keepContextOpenUntilExit(browser, "已设置 --keep-open true，保留百度浏览器窗口。");
    } else {
      await closeContextSafely(browser);
    }
  }
}

async function collectBaiduIndexViaPageMode(
  page: PageLike,
  browser: BrowserContextLike,
  options: Options,
  intercepted: Partial<Record<BaiduIndexKind, SearchIndexResponse[]>>,
  responseCaptureTasks: Set<Promise<void>>,
): Promise<CollectOutput> {
    if (page.url().includes("#/trend")) {
      await page.goto(DEFAULT_HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      await page.waitForSelector("body", { timeout: options.timeoutMs });
    }
    await setPageStatus(page, !options.headless, `正在查询百度指数：${options.words.join(", ")}`);
    // Mirror the Google page-mode pattern: arm response waiters first, install
    // route guards, then jump straight to the trend URL. The API responses
    // themselves are our readiness signal — no separate DOM polling needed.
    const initialApiResponses = waitForBaiduApiResponses(
      page,
      ["search", "feed"],
      options.timeoutMs,
      intercepted,
      responseCaptureTasks,
    );
    await protectBaiduIndexRoute(page, options.url);
    await lockBaiduIndexRoute(page, options.url);
    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await setPageStatus(page, !options.headless, "正在等待百度指数趋势页...");
    await initialApiResponses;
    await flushBaiduResponseCaptures(responseCaptureTasks);
    // If the API responses already cover every requested keyword, the page may
    // briefly show a "未被收录" hint banner during initial render that gets
    // wiped once the chart hydrates. Trust the API and skip the DOM check in
    // that case.
    const apiCoversAllWords = interceptedHasAllWords(intercepted, options.words);
    let unavailableWords = apiCoversAllWords ? [] : await detectUnavailableWords(page, options.words);
    if (unavailableWords.length > 0) {
      const message = unavailableWordsMessage(unavailableWords);
      runtimeWarn(message);
      await setContextStatus(browser, !options.headless, message);
      const availableWords = options.words.filter((word) => !unavailableWords.includes(word));
      if (availableWords.length > 0) {
        const retryOptions = optionsForWords(options, availableWords);
        intercepted.search = [];
        intercepted.feed = [];
        await setContextStatus(
          browser,
          !options.headless,
          `已剔除未收录词，正在重新查询：${unavailableWords.join(", ")}`,
        );
        const retryApiResponses = waitForBaiduApiResponses(
          page,
          ["search", "feed"],
          options.timeoutMs,
          intercepted,
          responseCaptureTasks,
        );
        await page.goto(retryOptions.url, {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs,
        });
        await retryApiResponses;
        await flushBaiduResponseCaptures(responseCaptureTasks);
      }
    }

    await setPageStatus(page, !options.headless, "正在提取百度搜索指数数据...");
    await flushBaiduResponseCaptures(responseCaptureTasks);
    let effectiveOptions = options;
    let overviewResult = await extractBaiduOverviews(page, effectiveOptions.words);
    if (!overviewResult.search.found && unavailableWords.length === 0 && options.words.length > 1) {
      unavailableWords = await findUnavailableWordsByProbing(page, browser, options);
      if (unavailableWords.length > 0) {
        const message = unavailableWordsMessage(unavailableWords);
        runtimeWarn(message);
        await setContextStatus(browser, !options.headless, message);
        const availableWords = options.words.filter((word) => !unavailableWords.includes(word));
        if (availableWords.length > 0) {
          const retryOptions = optionsForWords(options, availableWords);
          effectiveOptions = retryOptions;
          intercepted.search = [];
          intercepted.feed = [];
          const retryApiResponses = waitForBaiduApiResponses(
            page,
            ["search", "feed"],
            options.timeoutMs,
            intercepted,
            responseCaptureTasks,
          );
          await page.goto(retryOptions.url, {
            waitUntil: "domcontentloaded",
            timeout: options.timeoutMs,
          });
          await retryApiResponses;
          await flushBaiduResponseCaptures(responseCaptureTasks);
          overviewResult = await extractBaiduOverviews(page, retryOptions.words);
        }
      }
    }
    const searchOverview = overviewResult.search.rows;
    const feedOverview = overviewResult.feed.rows;
    const noDataReason = overviewResult.search.found ? undefined : "Search overview data structure not found";
    await setPageStatus(page, !options.headless, "正在采集百度搜索指数和资讯指数数据...");
    const [searchResult, feedResult] = await Promise.all([
      noDataReason
        ? Promise.resolve(emptyBaiduSection("search", effectiveOptions, searchOverview, noDataReason))
        : collectTrendData(page, effectiveOptions, "search", intercepted.search || [], searchOverview, {
          allowDirectApi: false,
          allowFallbackApi: true,
        }),
      collectTrendData(
        page,
        effectiveOptions,
        "feed",
        intercepted.feed || [],
        feedOverview,
        { allowDirectApi: false, allowFallbackApi: true },
      ),
    ]);
    await setPageStatus(
      page,
      !options.headless,
      `百度采集完成：搜索指数 ${searchResult.trends.length} 组，资讯指数 ${feedResult.trends.length} 组。`,
    );
    const missingWords = uniqueWords([
      ...unavailableWords,
      ...missingWordsFromSection(options.words, searchResult),
    ]);
    applyUnavailableWordDefaults(searchResult, missingWords);
    applyUnavailableWordDefaults(feedResult, missingWords);
    searchResult.unavailableWords = uniqueWords([
      ...(searchResult.unavailableWords || []),
      ...missingWordsFromSection(options.words, searchResult),
      ...unavailableWords,
    ]);
    feedResult.unavailableWords = uniqueWords([
      ...(feedResult.unavailableWords || []),
      ...unavailableWords,
    ]);
    if (missingWords.length > 0) {
      const message = unavailableWordsMessage(missingWords);
      runtimeWarn(message);
      await setContextStatus(browser, !options.headless, message);
    }

    return buildBaiduCollectOutput(options, page.url(), searchResult, feedResult, missingWords, noDataReason);
}

export function hasBaiduLoginInProfile(profileDir: string): boolean {
  return hasCookieInProfile(profileDir, ["BDUSS", "BDUSS_BFESS"]);
}

async function tryCollectBaiduIndexFromApi(
  page: PageLike,
  browser: BrowserContextLike,
  options: Options,
  intercepted: Partial<Record<BaiduIndexKind, SearchIndexResponse[]>>,
): Promise<CollectOutput | undefined> {
  await setPageStatus(page, !options.headless, "正在通过百度接口直接获取指数数据...");
  try {
    intercepted.search = [];
    intercepted.feed = [];
    if (!page.url().includes("#/trend")) {
      await page.goto(options.url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      await page.waitForSelector("body", { timeout: options.timeoutMs });
    }
    await waitForPageSettled(page);

    const [searchResult, feedResult] = await Promise.all([
      collectTrendData(page, options, "search", intercepted.search || [], options.words.map(defaultOverviewRow), {
        allowDirectApi: true,
      }),
      collectTrendData(page, options, "feed", intercepted.feed || [], options.words.map(defaultOverviewRow), {
        allowDirectApi: true,
      }),
    ]);

    const hasData = hasTrendPoints(searchResult) || hasTrendPoints(feedResult);
    if (!hasData) {
      runtimeInfo("百度接口直连暂未获取到有效趋势数据，回退到页面采集。");
      await setPageStatus(page, !options.headless, "百度接口直连未获取到数据，正在回退到页面采集...");
      return undefined;
    }

    const missingWords = uniqueWords([
      ...missingWordsFromSection(options.words, searchResult),
      ...missingWordsFromSection(options.words, feedResult),
    ]);
    applyUnavailableWordDefaults(searchResult, missingWords);
    applyUnavailableWordDefaults(feedResult, missingWords);
    if (missingWords.length > 0) {
      const message = unavailableWordsMessage(missingWords);
      runtimeWarn(message);
      await setContextStatus(browser, !options.headless, message);
    }

    await setPageStatus(
      page,
      !options.headless,
      `百度接口采集完成：搜索指数 ${searchResult.trends.length} 组，资讯指数 ${feedResult.trends.length} 组。`,
    );
    return buildBaiduCollectOutput(options, page.url(), searchResult, feedResult, missingWords);
  } catch (error) {
    runtimeInfo(`百度接口直连失败，回退到页面采集：${error instanceof Error ? error.message : String(error)}`);
    await setPageStatus(page, !options.headless, "百度接口直连失败，正在回退到页面采集...");
    return undefined;
  }
}

function hasTrendPoints(section: BaiduIndexSection): boolean {
  return section.trends.some((trend) => trend.points.length > 0);
}

function buildBaiduCollectOutput(
  options: Options,
  sourceUrl: string,
  searchResult: BaiduIndexSection,
  feedResult: BaiduIndexSection,
  unavailableWords: string[],
  noDataReason?: string,
): CollectOutput {
  const status = hasOverviewData(searchResult.overview) ||
      hasOverviewData(feedResult.overview) ||
      searchResult.trends.length > 0 ||
      feedResult.trends.length > 0
    ? "ok"
    : "no_data";
  const reason = noDataReason ||
    (status === "no_data" ? searchResult.error || feedResult.error || "No Baidu index data found" : undefined);

  return {
    capturedAt: new Date().toISOString(),
    source: "baidu",
    sourceUrl,
    apiUrl: buildApiPath(options, "search"),
    apiUrls: {
      search: buildApiPath(options, "search"),
      feed: buildApiPath(options, "feed"),
    },
    words: options.words,
    status,
    reason,
    overview: searchResult.overview,
    trends: searchResult.trends,
    indices: {
      search: searchResult,
      feed: feedResult,
    },
    unavailableWords: unavailableWords.length > 0 ? unavailableWords : undefined,
    raw: options.raw ? searchResult.raw : undefined,
    error: searchResult.error || feedResult.error,
  };
}

async function submitHomeSearch(page: PageLike, options: Options): Promise<void> {
  const query = options.words.join(",");
  const inputSelector = "input[placeholder*='关键词'], input[placeholder*='查询']";
  await page.waitForSelector(inputSelector, { timeout: options.timeoutMs });
  await page.locator(inputSelector).click({ timeout: options.timeoutMs });
  await page.keyboard.press(platformSelectAllShortcut());
  await page.keyboard.type(query, { delay: 80 });
  await page.waitForTimeout(150);

  await page.waitForSelector(".search-input-operate", { timeout: options.timeoutMs });
  runtimeInfo(`正在点击百度指数搜索按钮：${query}`);
  await page.locator(".search-input-operate").click({ timeout: options.timeoutMs });
  await page.waitForTimeout(700);

  if (!page.url().includes("#/trend")) {
    runtimeInfo("百度指数搜索按钮暂未跳转，正在改用趋势页 URL 打开。");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }

  if (!page.url().includes("#/trend")) {
    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
  }
}

function platformSelectAllShortcut(): string {
  return process.platform === "darwin" ? "Meta+A" : "Control+A";
}

async function protectBaiduIndexRoute(page: PageLike, targetUrl: string): Promise<void> {
  await page.route("http://index.baidu.com/v2/index.html*", async (route) => {
    await blockHomeDocumentRedirect(route, targetUrl);
  });
  await page.route("https://index.baidu.com/v2/index.html*", async (route) => {
    await blockHomeDocumentRedirect(route, targetUrl);
  });
}

async function lockBaiduIndexRoute(page: PageLike, targetUrl: string): Promise<void> {
  const target = new URL(targetUrl);
  const targetHref = target.href;
  const targetHash = target.hash;
  await page.addInitScript(({ href, hash }: { href: string; hash: string }) => {
    const shouldBlock = (url: string | URL | null | undefined) => {
      if (!url) return false;
      try {
        const next = new URL(String(url), window.location.href);
        return next.hostname === "index.baidu.com" &&
          next.pathname === "/v2/index.html" &&
          !next.hash.startsWith("#/trend");
      } catch {
        return false;
      }
    };

    const restoreTrendHash = () => {
      if (
        window.location.hostname === "index.baidu.com" &&
        window.location.pathname === "/v2/main/index.html" &&
        !window.location.hash.startsWith("#/trend")
      ) {
        window.history.replaceState(window.history.state, document.title, hash);
      }
    };

    const pushState = window.history.pushState.bind(window.history);
    const replaceState = window.history.replaceState.bind(window.history);
    window.history.pushState = (state, title, url) => {
      if (shouldBlock(url)) return;
      return pushState(state, title, url);
    };
    window.history.replaceState = (state, title, url) => {
      if (shouldBlock(url)) return;
      return replaceState(state, title, url);
    };

    const assign = window.location.assign.bind(window.location);
    const replace = window.location.replace.bind(window.location);
    window.location.assign = (url) => {
      if (shouldBlock(url)) return;
      return assign(url);
    };
    window.location.replace = (url) => {
      if (shouldBlock(url)) return;
      return replace(url);
    };

    window.addEventListener("hashchange", restoreTrendHash);
    window.addEventListener("popstate", restoreTrendHash);
    window.addEventListener("DOMContentLoaded", () => {
      if (window.location.href === href || window.location.pathname === "/v2/main/index.html") {
        restoreTrendHash();
      }
    });
  }, { href: targetHref, hash: targetHash });
}

async function blockHomeDocumentRedirect(route: RouteLike, targetUrl: string): Promise<void> {
  const request = route.request();
  if (request.resourceType() !== "document") {
    await route.continue();
    return;
  }

  const requestUrl = request.url();
  if (isTargetUrl(requestUrl, targetUrl)) {
    await route.continue();
    return;
  }

  runtimeInfo(`已拦截百度指数重定向：${requestUrl}`);
  await route.fulfill({
    status: 204,
    body: "",
  });
}

function isTargetUrl(requestUrl: string, targetUrl: string): boolean {
  const request = new URL(requestUrl);
  const target = new URL(targetUrl);
  return request.origin === target.origin && request.pathname === target.pathname;
}

async function collectTrendData(
  page: PageLike,
  options: Options,
  kind: BaiduIndexKind,
  intercepted: SearchIndexResponse[],
  overview: OverviewRow[],
  collectOptions: { allowDirectApi?: boolean; allowFallbackApi?: boolean } = {},
): Promise<BaiduIndexSection> {
  const apiUrl = buildApiPath(options, kind);
  try {
    const rawResponse =
      intercepted.find((item) => hasWords(item, options.words) && hasDateRange(item, options)) ||
      intercepted.find((item) => hasWords(item, options.words)) ||
      intercepted[0] ||
      (collectOptions.allowDirectApi || collectOptions.allowFallbackApi ? await fetchIndexApi(page, options, kind) : undefined);
    if (!rawResponse) {
      return {
        apiUrl,
        overview,
        trends: [],
        error: `Baidu ${kind} index returned no trend data: page response not captured`,
      };
    }
    const raw = await ensureDecrypted(page, rawResponse, kind);

    if (!rawIndexes(raw).length) {
      return {
        apiUrl,
        overview,
        trends: [],
        unavailableWords: inferUnavailableWords(options.words, raw),
        raw,
        error: `Baidu ${kind} index returned no trend data: ${raw.message || "empty response"}`,
      };
    }

    return {
      apiUrl,
      overview,
      trends: decodeBaiduTrends(raw, kind),
      unavailableWords: inferUnavailableWords(options.words, raw),
      raw,
    };
  } catch (error) {
    return {
      apiUrl,
      overview,
      trends: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function extractBaiduOverviews(
  page: PageLike,
  words: string[],
): Promise<Record<BaiduIndexKind, { found: boolean; rows: OverviewRow[] }>> {
  const [search, feed] = await Promise.all([
    extractOverview(page, words, ["搜索指数概览", "百度指数数据概览"]),
    extractOverview(page, words, ["资讯指数概览"]),
  ]);
  return { search, feed };
}

async function extractOverview(
  page: PageLike,
  words: string[],
  titles: string[],
): Promise<{ found: boolean; rows: OverviewRow[] }> {
  await page.waitForSelector("body", { timeout: 20_000 });
  await page.waitForTimeout(250);
  const rows = await page.evaluate((sectionTitles) => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const wrappers = [...document.querySelectorAll(".content-wrapper")];
    const wrapper = wrappers.find((item) => {
      const text = normalize(item.textContent);
      return sectionTitles.some((title) => text.includes(title));
    });
    const table = wrapper?.querySelector("table.veui-table");
    if (!table) return [];

    return [...table.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => normalize(cell.textContent)),
    );
  }, titles);

  const overview: OverviewRow[] = [];
  for (const cells of rows) {
    const row = overviewRowFromCells(cells);
    if (!row) continue;
    if (words.length === 0 || words.includes(row.keyword)) {
      overview.push(row);
    }
  }

  return overview.length > 0
    ? { found: true, rows: overview }
    : { found: false, rows: words.map(defaultOverviewRow) };
}

async function fetchIndexApi(page: PageLike, options: Options, kind: BaiduIndexKind): Promise<SearchIndexResponse> {
  const apiPath = buildApiPath(options, kind);
  const result = await evaluateBaiduApiInPage(page, async (path) => {
    const response = await fetch(path, {
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    return response.json();
  }, apiPath) as SearchIndexResponse;

  if (!result.data?.uniqid) return result;
  return ensureDecrypted(page, result, kind);
}

async function evaluateBaiduApiInPage<Arg, Result>(
  page: PageLike,
  callback: (arg: Arg) => Result | Promise<Result>,
  arg: Arg,
): Promise<Result> {
  try {
    return await page.evaluate(callback as never, arg);
  } catch (error) {
    if (isTargetClosedError(error)) throw error;
    return evaluateWithNavigationRetry(page, callback, arg);
  }
}

async function ensureLoggedIn(context: BrowserContextLike, page: PageLike, options: Options): Promise<void> {
  if (await hasValidBaiduLogin(context, page)) return;

  runtimeInfo(`百度账号未登录，请在打开的浏览器中完成登录；最多等待 ${Math.round(options.loginTimeoutMs / 60_000)} 分钟...`);
  await setBaiduLoginGuide(page, !options.headless);
  try {
    await waitForBaiduLogin(context, page, options.loginTimeoutMs, !options.headless);
  } finally {
    await setBaiduLoginGuide(page, false);
  }
  await setPageStatus(page, !options.headless, "已检测到百度登录，正在返回指数页...");

  await page.goto(DEFAULT_HOME_URL, {
    waitUntil: "domcontentloaded",
    timeout: options.timeoutMs,
  });
  await page.waitForSelector("body", { timeout: options.timeoutMs });
  await waitForBaiduHomeHydrated(page, options.timeoutMs);

  // Defense in depth: after we navigate back to index.baidu.com, the actual
  // logged-in UI either appears or the page redirects to a login prompt. If
  // the login state we detected was transient (e.g., the login window was
  // closed mid-flow and an intermediate redirect was misread as success),
  // re-verifying here catches it instead of continuing into garbage data.
  if (!await hasValidBaiduLogin(context, page)) {
    throw new Error("百度登录验证失败：返回首页后仍未检测到有效登录，请重新发起登录。");
  }
}

async function waitForBaiduLogin(
  context: BrowserContextLike,
  page: PageLike,
  timeoutMs: number,
  showStatus = false,
): Promise<void> {
  const startedAt = Date.now();
  let lastNoticeAt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    assertBrowserSessionAlive(context, "百度");
    assertLoginWindowOpen(context, page, "百度");
    try {
      if (await hasValidBaiduLogin(context, page)) {
        logContextStatus(context, "已检测到百度登录，继续执行任务...");
        emitStatusFromContext(context, "已检测到百度登录，继续执行任务...");
        await setContextStatus(context, showStatus, "已检测到百度登录，继续执行任务...");
        return;
      }
    } catch (error) {
      if (isTargetClosedError(error)) throw new Error(loginWindowClosedMessage("百度"));
      throw error;
    }

    if (Date.now() - lastNoticeAt > 10_000) {
      const remainingSeconds = Math.max(0, Math.ceil((timeoutMs - (Date.now() - startedAt)) / 1000));
      logContextStatus(context, `等待百度登录中，剩余 ${remainingSeconds} 秒`);
      emitStatusFromContext(context, `等待百度登录中，剩余 ${remainingSeconds} 秒`);
      await setContextStatus(context, showStatus, `等待百度登录中，剩余 ${remainingSeconds} 秒`);
      lastNoticeAt = Date.now();
    }

    try {
      await page.waitForTimeout(1_000);
    } catch (error) {
      if (isTargetClosedError(error)) throw new Error(loginWindowClosedMessage("百度"));
      throw error;
    }
  }

  throw new Error("等待百度登录超时；请在打开的浏览器中完成登录后重新运行");
}

const contextStatusHandlers = new WeakMap<BrowserContextLike, (message: string) => void>();
const contextQuietStatus = new WeakSet<BrowserContextLike>();
const BAIDU_RESPONSE_CAPTURE_TIMEOUT_MS = 1_500;

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

function queueBaiduResponseCapture(
  response: ResponseLike,
  intercepted: Partial<Record<BaiduIndexKind, SearchIndexResponse[]>>,
  tasks: Set<Promise<void>>,
): void {
  const task = captureBaiduApiResponse(response, intercepted);
  if (!task) return;
  tasks.add(task);
  task.finally(() => tasks.delete(task));
}

function captureBaiduApiResponse(
  response: ResponseLike,
  intercepted: Partial<Record<BaiduIndexKind, SearchIndexResponse[]>>,
): Promise<void> | undefined {
  const kind = baiduApiKindFromUrl(response.url());
  if (!kind) return undefined;
  return readJsonResponse<SearchIndexResponse>(response).then((json) => {
    if (json) intercepted[kind]?.push(json);
  });
}

async function waitForBaiduApiResponses(
  page: PageLike,
  kinds: BaiduIndexKind[],
  timeoutMs: number,
  intercepted: Partial<Record<BaiduIndexKind, SearchIndexResponse[]>>,
  tasks: Set<Promise<void>>,
): Promise<void> {
  if (!page.waitForResponse) return;
  const captureTimeoutMs = Math.min(Math.max(timeoutMs, 1_000), BAIDU_RESPONSE_CAPTURE_TIMEOUT_MS);
  await Promise.allSettled(kinds.map(async (kind) => {
    const response = await page.waitForResponse!(
      (candidate) => baiduApiKindFromUrl(candidate.url()) === kind,
      { timeout: captureTimeoutMs },
    );
    queueBaiduResponseCapture(response, intercepted, tasks);
  }));
}

async function flushBaiduResponseCaptures(tasks: Set<Promise<void>>): Promise<void> {
  if (tasks.size === 0) return;
  await Promise.allSettled([...tasks]);
}

async function isLoggedInFromPage(page: PageLike): Promise<boolean> {
  try {
    // Login state is only observable on index.baidu.com itself. Mid-login the
    // page may be on passport.baidu.com, accounts.baidu.com, about:blank, or
    // in a transient redirect — in any of those states we cannot tell from the
    // body text whether the user is actually logged in.
    const url = safePageUrl(page);
    if (!/index\.baidu\.com/.test(url)) return false;

    const text = await page.locator("body").innerText({ timeout: 2_000 });
    return isBaiduLoggedInText(text);
  } catch (error) {
    if (isTargetClosedError(error)) throw error;
    return false;
  }
}

/**
 * Index.baidu.com is a React SPA — `body.innerText` right after
 * `domcontentloaded` is often a skeleton or empty. Poll directly for hydrated
 * content rather than waiting on `networkidle` (Baidu fires periodic analytics
 * that keep the network busy long after the UI is ready). Bounded so we never
 * block the verification flow for long.
 */
async function waitForBaiduHomeHydrated(page: PageLike, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 4_000);
  while (Date.now() < deadline) {
    try {
      const text = await page.locator("body").innerText({ timeout: 800 });
      const normalized = text.replace(/\s+/g, "");
      // Once nav + main content are rendered the page easily clears 120 chars.
      // 80 is a conservative floor that still rejects skeleton states.
      if (normalized.length >= 80) return;
    } catch {
      // ignore; try again
    }
    await page.waitForTimeout(150);
  }
}

async function hasValidBaiduLogin(context: BrowserContextLike, page: PageLike): Promise<boolean> {
  return await hasBaiduLoginCookie(context) && await isLoggedInFromPage(page);
}

export function isBaiduLoggedInText(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  // Require substantial page content so we don't accept an empty/about:blank/
  // mid-redirect page as "logged in" by accident.
  if (normalized.length < 30) return false;
  if (isBaiduLoginPromptText(text)) return false;
  // If the dropdown rendered into innerText, trust the explicit logout link.
  if (/退出登录|退出账号/.test(normalized)) return true;
  // Otherwise look for a bare "登录" / "注册" CTA — those only appear in the
  // top nav when the user is signed out. The logged-in nav shows the user's
  // avatar/name (and the logout link is folded into a hover dropdown that
  // isn't included in innerText).
  if (/登录|注册/.test(normalized)) return false;
  return true;
}

export function isBaiduLoginPromptText(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return /扫码登录|用户名登录|密码登录|短信登录|立即登录|登录百度账号|请登录|请先登录|安全验证/.test(normalized);
}

function safePageUrl(page: PageLike): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

async function hasBaiduLoginCookie(context: BrowserContextLike): Promise<boolean> {
  const cookies = await context.cookies([
    "https://www.baidu.com",
    "https://index.baidu.com",
    "https://passport.baidu.com",
  ]);
  return cookies.some((cookie) =>
    ["BDUSS", "BDUSS_BFESS"].includes(cookie.name) && cookie.value.length > 0,
  );
}

async function ensureDecrypted(
  page: PageLike,
  response: SearchIndexResponse,
  kind: BaiduIndexKind,
): Promise<SearchIndexResponse> {
  if (!response.data?.uniqid || isAlreadyDecoded(response, kind)) return response;

  const key = await fetchDecryptKey(page, response.data.uniqid);
  return decryptIndexResponse(response, key, kind);
}

async function fetchDecryptKey(page: PageLike, uniqid: string): Promise<string> {
  const path = `/Interface/ptbk?uniqid=${encodeURIComponent(uniqid)}`;
  const result = await evaluateBaiduApiInPage(page, async (url) => {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    return response.json();
  }, path) as { data?: string };

  if (!result.data) {
    throw new Error("Baidu Index decrypt key response did not include data");
  }
  return result.data;
}

function buildApiPath(options: Options, kind: BaiduIndexKind = "search"): string {
  const params = new URLSearchParams();
  params.set("area", options.area);
  params.set("word", JSON.stringify(options.words.map((name) => [{ name, wordType: 1 }])));
  if (options.startDate) params.set("startDate", options.startDate);
  if (options.endDate) params.set("endDate", options.endDate);
  const path = kind === "feed" ? "/api/FeedSearchApi/getFeedIndex" : "/api/SearchApi/index";
  return `${path}?${params.toString()}`;
}

function decryptIndexResponse(response: SearchIndexResponse, key: string, kind: BaiduIndexKind): SearchIndexResponse {
  if (kind === "feed") {
    const decodedFeed = feedIndexes(response).map((item) => ({
      ...item,
      data: decryptSeries(item.data, key),
    }));
    return {
      ...response,
      data: {
        ...response.data,
        index: decodedFeed,
      },
    };
  }

  const decodedSearch = searchIndexes(response).map((item) => ({
    ...item,
    all: item.all ? { ...item.all, data: decryptSeries(item.all.data, key) } : item.all,
    pc: item.pc ? { ...item.pc, data: decryptSeries(item.pc.data, key) } : item.pc,
    wise: item.wise ? { ...item.wise, data: decryptSeries(item.wise.data, key) } : item.wise,
  }));
  return {
    ...response,
    data: {
      ...response.data,
      userIndexes: decodedSearch,
    },
  };
}

function decryptSeries(encrypted: string, key: string): string {
  const table = new Map<string, string>();
  const half = Math.floor(key.length / 2);
  const first = key.slice(0, half);
  const second = key.slice(half);
  for (let index = 0; index < first.length; index += 1) {
    table.set(first[index], second[index]);
  }
  return [...encrypted].map((char) => table.get(char) ?? char).join("");
}

export function decodeBaiduTrends(response: SearchIndexResponse, kind: BaiduIndexKind): KeywordTrend[] {
  if (kind === "feed") return decodeFeedTrends(response);
  return searchIndexes(response).map((item) => {
    const all = decodeSeries(item.all);
    const pc = decodeSeries(item.pc);
    const wise = decodeSeries(item.wise);
    const length = Math.max(all.values.length, pc.values.length, wise.values.length);
    const startDate = all.startDate || pc.startDate || wise.startDate;
    if (!startDate) {
      throw new Error(`Missing startDate for ${wordLabel(item.word)}`);
    }

    return {
      word: wordLabel(item.word),
      points: Array.from({ length }, (_, index) => ({
        date: addDays(startDate, index),
        all: all.values[index] ?? null,
        pc: pc.values[index] ?? null,
        wise: wise.values[index] ?? null,
      })),
    };
  });
}

function decodeFeedTrends(response: SearchIndexResponse): KeywordTrend[] {
  return feedIndexes(response).map((item) => {
    const series = decodeSeries({
      startDate: item.startDate,
      endDate: item.endDate,
      data: item.data,
    });
    return {
      word: wordLabel(item.key),
      points: series.values.map((value, index) => ({
        date: addDays(item.startDate, index),
        all: value,
        pc: null,
        wise: null,
      })),
    };
  });
}

function decodeSeries(series: RawIndexSeries | undefined): { startDate?: string; values: (number | null)[] } {
  if (!series?.data) return { values: [] };
  return {
    startDate: series.startDate,
    values: series.data.split(",").map((value) => {
      if (value === "" || value === "null") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }),
  };
}

function wordLabel(word: RawSearchIndexGroup["word"] | RawFeedIndexGroup["key"]): string {
  if (typeof word === "string") return word;
  return word.map((item) => item.name).filter(Boolean).join(",") || "unknown";
}

async function waitForIndexPage(page: PageLike, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await page.locator("body").innerText({ timeout: 5_000 });
    if (isProbablyIndexPage(text)) return;
    if (isProbablyLogin(text) || page.url().includes("passport.baidu.com")) {
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(500);
  }

  const text = await page.locator("body").innerText({ timeout: 5_000 });
  throw new Error(
    isProbablyLogin(text)
      ? "等待百度指数登录超时；请在打开的浏览器中完成登录后重新运行"
      : "等待百度指数趋势页超时",
  );
}

async function detectUnavailableWords(page: PageLike, words: string[]): Promise<string[]> {
  try {
    const text = await page.locator("body").innerText({ timeout: 2_000 });
    return unavailableWordsFromText(text, words);
  } catch {
    return [];
  }
}

export function unavailableWordsFromText(text: string, words: string[]): string[] {
  if (!/未被收录|创建新词|购买创建新词/.test(text)) return [];
  return words.filter((word) => text.includes(`关键词${word}未被收录`) || text.includes(`${word}未被收录`));
}

async function findUnavailableWordsByProbing(
  page: PageLike,
  context: BrowserContextLike,
  options: Options,
): Promise<string[]> {
  const unavailable: string[] = [];
  for (const word of options.words) {
    await setContextStatus(context, !options.headless, `正在检测百度关键词是否收录：${word}`);
    const probeOptions = optionsForWords(options, [word]);
    await page.goto(probeOptions.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    // Probing reads body text for `关键词X未被收录`, so we need enough
    // hydrated content but not the full waitForIndexPage polling loop.
    await waitForBaiduHomeHydrated(page, options.timeoutMs);

    const explicit = await detectUnavailableWords(page, [word]);
    if (explicit.includes(word)) {
      unavailable.push(word);
      continue;
    }

    const overview = await extractOverview(page, [word], ["搜索指数概览", "百度指数数据概览"]);
    if (!overview.found || !overview.rows.some((row) => row.keyword === word && hasOverviewData([row]))) {
      unavailable.push(word);
    }
  }
  return uniqueWords(unavailable);
}

function isProbablyIndexPage(text: string): boolean {
  return /百度指数|搜索指数|资讯指数|需求图谱|人群画像|趋势研究|整体趋势/.test(text);
}

function isProbablyLogin(text: string): boolean {
  return /登录|扫码|验证码|帐号|账号|百度一下/.test(text) && !isProbablyIndexPage(text);
}

function interceptedHasAllWords(
  intercepted: Partial<Record<BaiduIndexKind, SearchIndexResponse[]>>,
  words: string[],
): boolean {
  const responses = [...(intercepted.search || []), ...(intercepted.feed || [])];
  return responses.some((response) => hasWords(response, words));
}

function hasWords(response: SearchIndexResponse, words: string[]): boolean {
  const labels = new Set(rawIndexes(response).map((item) =>
    isFeedIndexGroup(item) ? wordLabel(item.key) : wordLabel(item.word)
  ));
  return words.every((word) => labels.has(word));
}

function hasDateRange(response: SearchIndexResponse, options: Pick<Options, "startDate" | "endDate">): boolean {
  if (!options.startDate && !options.endDate) return true;
  const ranges = rawIndexes(response)
    .flatMap((item) => isFeedIndexGroup(item)
      ? [{ startDate: item.startDate, endDate: item.endDate }]
      : [item.all, item.pc, item.wise].filter(Boolean).map((series) => ({
        startDate: series?.startDate,
        endDate: series?.endDate,
      }))
    )
    .filter((range) => range.startDate || range.endDate);
  if (ranges.length === 0) return false;
  return ranges.some((range) =>
    (!options.startDate || range.startDate === options.startDate) &&
    (!options.endDate || range.endDate === options.endDate)
  );
}

function inferUnavailableWords(words: string[], response: SearchIndexResponse): string[] {
  const labels = new Set(rawIndexes(response).map((item) =>
    isFeedIndexGroup(item) ? wordLabel(item.key) : wordLabel(item.word)
  ));
  const fromResponse = unavailableWordsFromText(response.message || "", words);
  if (labels.size === 0 && fromResponse.length === 0) return [];
  return uniqueWords([
    ...fromResponse,
    ...words.filter((word) => !labels.has(word)),
  ]);
}

function missingWordsFromSection(words: string[], section: BaiduIndexSection): string[] {
  const labels = new Set([
    ...section.overview.map((row) => row.keyword),
    ...section.trends.map((trend) => trend.word),
  ]);
  return uniqueWords([
    ...(section.unavailableWords || []),
    ...words.filter((word) => !labels.has(word)),
  ]);
}

function unavailableWordsMessage(words: string[]): string {
  return `百度指数关键词未被收录：${words.join(", ")}。可能需要购买或创建新词权限。`;
}

function uniqueWords(words: string[]): string[] {
  return [...new Set(words.filter(Boolean))];
}

function isAlreadyDecoded(response: SearchIndexResponse, kind: BaiduIndexKind): boolean {
  if (kind === "feed") {
    return feedIndexes(response).some((item) => item.data.split(",").some((value) => value === "0" || Number(value) > 0));
  }
  return searchIndexes(response).some((item) =>
    [item.all?.data, item.pc?.data, item.wise?.data].some((data) => {
      if (!data) return false;
      return data.split(",").some((value) => value === "0" || Number(value) > 0);
    }),
  );
}

function rawIndexes(response: SearchIndexResponse | undefined): RawIndexGroup[] {
  return response?.data?.userIndexes || response?.data?.index || [];
}

function searchIndexes(response: SearchIndexResponse | undefined): RawSearchIndexGroup[] {
  return response?.data?.userIndexes || [];
}

function feedIndexes(response: SearchIndexResponse | undefined): RawFeedIndexGroup[] {
  return response?.data?.index || [];
}

function isFeedIndexGroup(item: RawIndexGroup): item is RawFeedIndexGroup {
  return "key" in item;
}

function baiduApiKindFromUrl(url: string): BaiduIndexKind | undefined {
  if (url.includes("/api/SearchApi/index")) return "search";
  if (url.includes("/api/FeedSearchApi/getFeedIndex")) return "feed";
  return undefined;
}

function emptyBaiduSection(
  kind: BaiduIndexKind,
  options: Options,
  overview: OverviewRow[],
  error: string,
): BaiduIndexSection {
  return {
    apiUrl: buildApiPath(options, kind),
    overview,
    trends: [],
    error,
  };
}

function optionsForWords(options: Options, words: string[]): Options {
  return {
    ...options,
    words,
    url: buildBaiduTrendUrl(words),
  };
}

export function applyUnavailableWordDefaults(section: BaiduIndexSection, words: string[]): void {
  for (const word of words) {
    if (!section.overview.some((row) => row.keyword === word)) {
      section.overview.push(zeroOverviewRow(word));
    }
    if (!section.trends.some((trend) => trend.word === word)) {
      section.trends.push(zeroKeywordTrend(word));
    }
  }
}

function zeroKeywordTrend(word: string): KeywordTrend {
  return {
    word,
    points: [],
  };
}

function addDays(dateText: string, days: number): string {
  const [year = 0, month = 1, day = 1] = dateText.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}
