import { describe, expect, test } from "bun:test";
import type { CollectOutput, Options } from "../src/types.js";
import { toUnifiedMultiSourceOutput, toUnifiedOutput } from "../src/unified-output.js";

const baseOptions: Options = {
  source: "google",
  lang: "en",
  url: "",
  words: ["gemini"],
  profileDir: "profiles/google",
  out: "exports/out.json",
  format: "json",
  raw: false,
  headless: true,
  keepOpen: false,
  timeoutMs: 60_000,
  loginTimeoutMs: 300_000,
  range: "today 1-m",
  rangeLabel: "30d",
  geo: "US",
  area: "0",
};

describe("toUnifiedOutput", () => {
  test("converts Google trends and related queries", () => {
    const output: CollectOutput = {
      capturedAt: "2026-05-23T00:00:00.000Z",
      source: "google",
      sourceUrl: "https://trends.google.com/trends/explore",
      apiUrl: "https://trends.google.com/trends/api/widgetdata/multiline?token=[redacted]",
      words: ["gemini"],
      status: "ok",
      overview: [{
        keyword: "gemini",
        overallDailyAverage: 62,
        mobileDailyAverage: null,
        overallYearOverYear: null,
        overallMonthOverMonth: null,
        mobileYearOverYear: null,
        mobileMonthOverMonth: null,
      }],
      trends: [{
        word: "gemini",
        points: [{ date: "2026-05-22", all: 94, pc: null, wise: null }],
      }],
      relatedQueries: {
        gemini: {
          top: [{ query: "gemini google", value: 100, formattedValue: "100" }],
          rising: [{ query: "gemini cli", value: 5000, formattedValue: "Breakout" }],
        },
      },
    };

    const unified = toUnifiedOutput(output, baseOptions);

    expect(unified.schemaVersion).toBe(1);
    expect(unified.source).toBe("google");
    expect(unified.query.range).toBe("30d");
    expect(unified.query.region).toBe("US");
    expect(unified.results[0]?.search?.unit).toBe("relative");
    expect(unified.results[0]?.search?.points[0]).toEqual({
      date: "2026-05-22",
      value: 94,
      pc: null,
      mobile: null,
    });
    expect(unified.results[0]?.relatedQueries?.rising[0]?.label).toBe("Breakout");
  });

  test("converts Baidu search/feed data and unavailable words", () => {
    const output: CollectOutput = {
      capturedAt: "2026-05-23T00:00:00.000Z",
      source: "baidu",
      sourceUrl: "https://index.baidu.com",
      apiUrl: "/api/SearchApi/index",
      apiUrls: {
        search: "/api/SearchApi/index",
        feed: "/api/FeedSearchApi/getFeedIndex",
      },
      words: ["微信指数", "百度指数abc"],
      status: "ok",
      overview: [],
      trends: [],
      unavailableWords: ["百度指数abc"],
      indices: {
        search: {
          apiUrl: "/api/SearchApi/index",
          overview: [
            {
              keyword: "微信指数",
              overallDailyAverage: 187,
              mobileDailyAverage: 68,
              overallYearOverYear: { percent: -25, direction: "down" },
              overallMonthOverMonth: { percent: -8, direction: "down" },
              mobileYearOverYear: null,
              mobileMonthOverMonth: null,
            },
            {
              keyword: "百度指数abc",
              overallDailyAverage: 0,
              mobileDailyAverage: 0,
              overallYearOverYear: null,
              overallMonthOverMonth: null,
              mobileYearOverYear: null,
              mobileMonthOverMonth: null,
            },
          ],
          trends: [
            {
              word: "微信指数",
              points: [{ date: "2026-05-22", all: 180, pc: 112, wise: 68 }],
            },
          ],
        },
        feed: {
          apiUrl: "/api/FeedSearchApi/getFeedIndex",
          overview: [
            {
              keyword: "微信指数",
              overallDailyAverage: 43,
              mobileDailyAverage: null,
              overallYearOverYear: null,
              overallMonthOverMonth: null,
              mobileYearOverYear: null,
              mobileMonthOverMonth: null,
            },
            {
              keyword: "百度指数abc",
              overallDailyAverage: 0,
              mobileDailyAverage: 0,
              overallYearOverYear: null,
              overallMonthOverMonth: null,
              mobileYearOverYear: null,
              mobileMonthOverMonth: null,
            },
          ],
          trends: [
            {
              word: "微信指数",
              points: [{ date: "2026-05-22", all: 41, pc: null, wise: null }],
            },
          ],
        },
      },
    };

    const unified = toUnifiedOutput(output, {
      ...baseOptions,
      source: "baidu",
      words: ["微信指数", "百度指数abc"],
      geo: "",
      area: "0",
      days: 30,
      range: undefined,
      rangeLabel: "30d",
    });

    expect(unified.status).toBe("partial");
    expect(unified.query.region).toBe("0");
    expect(unified.results[0]?.search?.unit).toBe("index");
    expect(unified.results[0]?.feed?.average).toBe(43);
    expect(unified.results[0]?.search?.points[0]).toEqual({
      date: "2026-05-22",
      value: 180,
      pc: 112,
      mobile: 68,
    });
    expect(unified.results[1]?.status).toBe("unavailable");
    expect(unified.results[1]?.message).toBe("关键词未被百度指数收录");
    expect(unified.messages).toEqual(["1 个关键词不可用或未收录"]);
  });

  test("wraps multiple source outputs", () => {
    const google = toUnifiedOutput({
      capturedAt: "2026-05-23T00:00:00.000Z",
      source: "google",
      sourceUrl: "https://trends.google.com",
      apiUrl: "https://trends.google.com/api",
      words: ["gemini"],
      status: "ok",
      overview: [],
      trends: [],
    }, baseOptions);
    const baidu = toUnifiedOutput({
      capturedAt: "2026-05-23T00:00:00.000Z",
      source: "baidu",
      sourceUrl: "https://index.baidu.com",
      apiUrl: "/api/SearchApi/index",
      words: ["gemini"],
      status: "no_data",
      reason: "No data",
      overview: [],
      trends: [],
    }, { ...baseOptions, source: "baidu", area: "0", geo: "" });

    const combined = toUnifiedMultiSourceOutput([google, baidu], { ...baseOptions, source: "all" });

    expect(combined.source).toBe("all");
    expect(combined.status).toBe("partial");
    expect(combined.query.range).toBe("30d");
    expect(combined.query.startDate).toBeNull();
    expect(combined.query.endDate).toBeNull();
    expect(combined.results.map((result) => result.source)).toEqual(["google", "baidu"]);
  });
});
