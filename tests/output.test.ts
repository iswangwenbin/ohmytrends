import { describe, expect, test } from "bun:test";
import stringWidth from "string-width";
import { renderTable } from "../src/output.js";

describe("table output", () => {
  test("aligns columns with full-width Chinese headers", () => {
    const table = renderTable(
      ["关键词", "平均值", "最新值", "点数"],
      [["gpt", "82", "2026-05-28 83", "31"]],
    );
    const [header, divider, row] = table.split("\n");

    expect(displayColumn(header, "平均值")).toBe(displayColumn(row, "82"));
    expect(displayColumn(header, "最新值")).toBe(displayColumn(row, "2026-05-28 83"));
    expect(displayColumn(header, "点数")).toBe(displayColumn(row, "31"));
    expect(divider).toBe("------  ------  -------------  ----");
  });
});

function displayColumn(line: string, token: string): number {
  return stringWidth(line.slice(0, line.indexOf(token)));
}
