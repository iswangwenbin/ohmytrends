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
    // Logged-in pages have plenty of content (chart, controls, user menu, etc.)
    // — well above the min-length threshold that rejects blank/transient pages.
    expect(isBaiduLoggedInText(
      "百度指数 趋势研究 我的指数 行业排行 词包管理 ps5fans 个人中心 设置 退出 帮助中心 反馈 认证微信"
    )).toBe(true);
  });

  test("rejects empty or near-empty pages as logged in", () => {
    // about:blank or transient redirect — body text is empty or trivially
    // short. We must not interpret the absence of login prompts as success.
    expect(isBaiduLoggedInText("")).toBe(false);
    expect(isBaiduLoggedInText("   \n\t  ")).toBe(false);
    expect(isBaiduLoggedInText("Loading...")).toBe(false);
  });

  test("rejects the logged-out home page even when no modal phrases are visible", () => {
    // Regression: the logged-out index.baidu.com home shows a bare "登录"
    // CTA in the top nav but none of the modal-only phrases (扫码登录,
    // 立即登录, ...). The text is long, on the right domain, has no negative
    // markers — but is still logged out.
    const loggedOutHome = [
      "百度指数 趋势研究 需求图谱 资讯指数 人群画像 全部产品 帮助",
      "热搜词 实时热点 行业榜单 排行榜 城市榜",
      "登录 注册 反馈 关于我们 联系我们 加入我们",
      "请输入关键词 搜索",
    ].join(" ");
    expect(loggedOutHome.length).toBeGreaterThan(30);
    expect(isBaiduLoginPromptText(loggedOutHome)).toBe(false);
    expect(isBaiduLoggedInText(loggedOutHome)).toBe(false);
  });

  test("accepts logged-in home where the logout link is hidden in a dropdown", () => {
    // Regression: the logged-in index.baidu.com home shows the user's avatar
    // / username (e.g. "ps5fans") in the top nav, but `退出登录` lives in a
    // collapsed dropdown that doesn't appear in `body.innerText`. We must
    // not require an explicit positive marker — absence of any "登录" /
    // "注册" CTA is sufficient evidence of being signed in.
    const loggedInHome = [
      "百度指数 趋势研究 需求图谱 资讯指数 人群画像 全部产品",
      "限时福利 关注微信 帮助中心 ps5fans",
      "搜索趋势 资讯指数 热点榜单",
      "请输入关键词 搜索 添加对比",
    ].join(" ");
    expect(loggedInHome.length).toBeGreaterThan(30);
    expect(isBaiduLoginPromptText(loggedInHome)).toBe(false);
    expect(isBaiduLoggedInText(loggedInHome)).toBe(true);
  });
});
