import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { styleText } from "node:util";
import stringWidth from "string-width";
import type { ChangeMetric, CollectOutput, IndexPoint, Options, TerminalLanguage } from "./types.js";

export function writeOutput(output: CollectOutput, out: string): void {
  writeJsonOutput(output, out);
}

export function writeJsonOutput(output: unknown, out: string): void {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
}

export function printOutputJson(output: unknown): void {
  console.log(JSON.stringify(output, null, 2));
}

export function printOutputSummary(output: CollectOutput, options: Options): void {
  const labels = outputLabels(options.lang);
  console.log(summaryLine(labels.source, output.source, "source"));
  console.log(summaryLine(
    labels.status,
    `${statusLabel(output.status, options.lang)}${output.reason ? ` (${output.reason})` : ""}`,
    output.status === "ok" ? "success" : "warning",
  ));
  if (output.unavailableWords?.length) {
    console.log(summaryLine(labels.unavailableWords, output.unavailableWords.join(", "), "warning"));
  }
  console.log(summaryLine(labels.savedTo, options.out, "path"));
  console.log("");

  const latestByWord = new Map<string, IndexPoint | undefined>();
  const pointsByWord = new Map<string, number>();
  for (const trend of output.trends) {
    const latest = [...trend.points].reverse().find((point) => point.all !== null);
    latestByWord.set(trend.word, latest);
    pointsByWord.set(trend.word, trend.points.length);
  }

  const rows = output.overview.map((row) => {
    const latest = latestByWord.get(row.keyword);
    return output.source === "google"
      ? [
          row.keyword,
          formatNullable(row.overallDailyAverage),
          latest ? `${latest.date} ${formatNullable(latest.all)}` : "-",
          String(pointsByWord.get(row.keyword) || 0),
        ]
      : [
          row.keyword,
          formatNullable(row.overallDailyAverage),
          formatNullable(row.mobileDailyAverage),
          formatChange(row.overallYearOverYear),
          formatChange(row.overallMonthOverMonth),
          latest ? `${latest.date} ${formatNullable(latest.all)}` : "-",
          String(pointsByWord.get(row.keyword) || 0),
        ];
  });

  printTable(
    output.source === "google"
      ? [labels.keyword, labels.average, labels.latest, labels.points]
      : [labels.keyword, labels.average, labels.mobile, labels.yearOverYear, labels.monthOverMonth, labels.latest, labels.points],
    rows,
  );

  const feedOverview = output.indices?.feed?.overview || [];
  if (output.source === "baidu" && feedOverview.length > 0) {
    console.log("");
    console.log(labels.feedOverview);
    printTable(
      [labels.keyword, labels.average, labels.mobile, labels.yearOverYear, labels.monthOverMonth],
      feedOverview.map((row) => [
        row.keyword,
        formatNullable(row.overallDailyAverage),
        formatNullable(row.mobileDailyAverage),
        formatChange(row.overallYearOverYear),
        formatChange(row.overallMonthOverMonth),
      ]),
    );
  }

  const dailyRows = output.trends.flatMap((trend) =>
    trend.points.map((point) => output.source === "google"
      ? [
          trend.word,
          point.date,
          formatNullable(point.all),
        ]
      : [
          trend.word,
          point.date,
          formatNullable(point.all),
          formatNullable(point.pc),
          formatNullable(point.wise),
        ]),
  );

  if (dailyRows.length > 0) {
    console.log("");
    console.log(output.source === "baidu" ? labels.searchDailyData : labels.dailyData);
    printTable(
      output.source === "google"
        ? [labels.keyword, labels.date, labels.value]
        : [labels.keyword, labels.date, labels.overall, "PC", labels.mobile],
      dailyRows,
    );
  }

  if (output.source === "google" && output.relatedQueries) {
    const relatedRows = Object.entries(output.relatedQueries).flatMap(([keyword, lists]) =>
      [...lists.rising.slice(0, 5).map((item) => [keyword, "rising", item.query, item.formattedValue || "-"]),
        ...lists.top.slice(0, 5).map((item) => [keyword, "top", item.query, item.formattedValue || "-"])],
    );
    if (relatedRows.length > 0) {
      console.log("");
      console.log(labels.relatedQueries);
      printTable([labels.keyword, labels.type, labels.query, labels.value], relatedRows.map(([keyword, type, query, value]) => [
        keyword,
        relatedQueryTypeLabel(type, options.lang),
        query,
        value,
      ]));
    }
  }

  const feedRows = output.indices?.feed?.trends.flatMap((trend) =>
    trend.points.map((point) => [
      trend.word,
      point.date,
      formatNullable(point.all),
      formatNullable(point.pc),
      formatNullable(point.wise),
    ]),
  ) || [];
  if (feedRows.length > 0) {
    console.log("");
    console.log(labels.feedDailyData);
    printTable([labels.keyword, labels.date, labels.overall, "PC", labels.mobile], feedRows);
  }
}

function statusLabel(status: CollectOutput["status"], lang: TerminalLanguage): string {
  if (lang === "zh") return status === "ok" ? "成功" : "无数据";
  return status === "ok" ? "ok" : "no data";
}

function summaryLine(label: string, value: string, valueKind: "source" | "success" | "warning" | "path"): string {
  return `${paint("cyan", `${label}:`)} ${paint(summaryValueColor(valueKind), value)}`;
}

function summaryValueColor(valueKind: "source" | "success" | "warning" | "path"): "blue" | "green" | "yellow" | "gray" {
  if (valueKind === "source") return "blue";
  if (valueKind === "success") return "green";
  if (valueKind === "warning") return "yellow";
  return "gray";
}

function paint(color: "cyan" | "blue" | "green" | "yellow" | "gray", text: string): string {
  return styleText(color, text, { validateStream: false });
}

function relatedQueryTypeLabel(type: string, lang: TerminalLanguage): string {
  if (lang !== "zh") return type;
  if (type === "rising") return "上升";
  if (type === "top") return "热门";
  return type;
}

function outputLabels(lang: TerminalLanguage) {
  if (lang === "zh") {
    return {
      source: "数据源",
      status: "状态",
      unavailableWords: "未收录关键词",
      savedTo: "保存到",
      keyword: "关键词",
      average: "平均值",
      latest: "最新值",
      points: "点数",
      mobile: "移动",
      yearOverYear: "同比",
      monthOverMonth: "环比",
      feedOverview: "资讯指数概览",
      searchDailyData: "搜索指数每日数据",
      dailyData: "每日数据",
      date: "日期",
      value: "数值",
      overall: "整体",
      relatedQueries: "相关查询",
      type: "类型",
      query: "查询词",
      feedDailyData: "资讯指数每日数据",
    };
  }

  return {
    source: "Source",
    status: "Status",
    unavailableWords: "Unavailable words",
    savedTo: "Saved to",
    keyword: "Keyword",
    average: "Average",
    latest: "Latest",
    points: "Points",
    mobile: "Mobile",
    yearOverYear: "YoY",
    monthOverMonth: "MoM",
    feedOverview: "Feed index overview",
    searchDailyData: "Search index daily data",
    dailyData: "Daily data",
    date: "Date",
    value: "Value",
    overall: "Overall",
    relatedQueries: "Related queries",
    type: "Type",
    query: "Query",
    feedDailyData: "Feed index daily data",
  };
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(stringWidth(header), ...rows.map((row) => stringWidth(row[index] || ""))),
  );
  const renderRow = (row: string[]) =>
    row.map((cell, index) => padCell(cell, widths[index])).join("  ");

  return [
    renderRow(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) => renderRow(row)),
  ].join("\n");
}

function printTable(headers: string[], rows: string[][]): void {
  console.log(renderTable(headers, rows));
}

function padCell(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - stringWidth(value)))}`;
}

function formatNullable(value: number | null): string {
  return value === null ? "-" : String(value);
}

function formatChange(value: ChangeMetric | null): string {
  if (!value || value.percent === null) return "-";
  const suffix = value.direction === "up"
    ? "↑"
    : value.direction === "down"
      ? "↓"
      : value.direction === "flat"
        ? "→"
        : "";
  return `${value.percent}%${suffix}`;
}
