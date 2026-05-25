import { describe, expect, test } from "bun:test";
import {
  applyUnavailableWordDefaults,
  decodeBaiduTrends,
  isBaiduLoggedInText,
  isBaiduLoginPromptText,
  unavailableWordsFromText,
} from "../src/baidu.js";

describe("Baidu index decoding", () => {
  test("decodes feed index payloads from data.index", () => {
    const trends = decodeBaiduTrends({
      status: 0,
      data: {
        index: [
          {
            key: [{ name: "微信指数" }],
            startDate: "2026-05-20",
            endDate: "2026-05-22",
            data: "10,20,",
          },
        ],
      },
    }, "feed");

    expect(trends).toEqual([
      {
        word: "微信指数",
        points: [
          { date: "2026-05-20", all: 10, pc: null, wise: null },
          { date: "2026-05-21", all: 20, pc: null, wise: null },
          { date: "2026-05-22", all: null, pc: null, wise: null },
        ],
      },
    ]);
  });

  test("extracts unindexed keywords from Baidu permission text", () => {
    const text = "关键词百度指数abc未被收录，如要查看相关数据，您需要购买创建新词的权限。";

    expect(unavailableWordsFromText(text, ["微信指数", "google", "百度指数abc"])).toEqual([
      "百度指数abc",
    ]);
  });

  test("adds zero defaults for unavailable keywords", () => {
    const section = {
      apiUrl: "/api/SearchApi/index",
      overview: [],
      trends: [],
    };

    applyUnavailableWordDefaults(section, ["百度指数abc"]);

    expect(section.overview).toEqual([
      {
        keyword: "百度指数abc",
        overallDailyAverage: 0,
        mobileDailyAverage: 0,
        overallYearOverYear: { percent: 0, direction: "flat" },
        overallMonthOverMonth: { percent: 0, direction: "flat" },
        mobileYearOverYear: { percent: 0, direction: "flat" },
        mobileMonthOverMonth: { percent: 0, direction: "flat" },
      },
    ]);
    expect(section.trends).toEqual([{ word: "百度指数abc", points: [] }]);
  });

  test("detects Baidu login prompt text without blocking normal account pages", () => {
    expect(isBaiduLoginPromptText("扫码登录 用户名登录 立即登录")).toBe(true);
    expect(isBaiduLoggedInText("认证微信 帮助中心 ps5fans 百度指数")).toBe(true);
  });
});
