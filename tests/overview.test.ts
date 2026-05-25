import { describe, expect, test } from "bun:test";
import { hasOverviewData, overviewRowFromCells } from "../src/overview.js";

describe("overview parsing", () => {
  test("parses Baidu overview rows with mobile and change metrics", () => {
    expect(overviewRowFromCells(["微信指数", "1,234", "567", "25%↑", "6%↓", "-", "0%"])).toEqual({
      keyword: "微信指数",
      overallDailyAverage: 1234,
      mobileDailyAverage: 567,
      overallYearOverYear: { percent: 25, direction: "up" },
      overallMonthOverMonth: { percent: 6, direction: "down" },
      mobileYearOverYear: { percent: null, direction: null },
      mobileMonthOverMonth: { percent: 0, direction: "flat" },
    });
  });

  test("detects whether overview rows contain data", () => {
    const row = overviewRowFromCells(["example", "-", "-", "-", "-", "-", "-"]);
    expect(row).toBeDefined();
    expect(hasOverviewData(row ? [row] : [])).toBe(false);
  });
});
