import type { ChangeMetric, OverviewRow } from "./types.js";

export function defaultOverviewRow(keyword: string): OverviewRow {
  return {
    keyword,
    overallDailyAverage: null,
    mobileDailyAverage: null,
    overallYearOverYear: null,
    overallMonthOverMonth: null,
    mobileYearOverYear: null,
    mobileMonthOverMonth: null,
  };
}

export function zeroOverviewRow(keyword: string): OverviewRow {
  return {
    keyword,
    overallDailyAverage: 0,
    mobileDailyAverage: 0,
    overallYearOverYear: { percent: 0, direction: "flat" },
    overallMonthOverMonth: { percent: 0, direction: "flat" },
    mobileYearOverYear: { percent: 0, direction: "flat" },
    mobileMonthOverMonth: { percent: 0, direction: "flat" },
  };
}

export function hasOverviewData(rows: OverviewRow[]): boolean {
  return rows.some((row) =>
    row.overallDailyAverage !== null ||
    row.mobileDailyAverage !== null ||
    row.overallYearOverYear?.percent != null ||
    row.overallMonthOverMonth?.percent != null ||
    row.mobileYearOverYear?.percent != null ||
    row.mobileMonthOverMonth?.percent != null,
  );
}

export function overviewRowFromCells(cells: string[]): OverviewRow | undefined {
  if (cells.length >= 7) {
    return {
      keyword: cells[0],
      overallDailyAverage: parseNumericCell(cells[1]),
      mobileDailyAverage: parseNumericCell(cells[2]),
      overallYearOverYear: parseChangeCell(cells[3]),
      overallMonthOverMonth: parseChangeCell(cells[4]),
      mobileYearOverYear: parseChangeCell(cells[5]),
      mobileMonthOverMonth: parseChangeCell(cells[6]),
    };
  }

  if (cells.length >= 4) {
    return {
      keyword: cells[0],
      overallDailyAverage: parseNumericCell(cells[1]),
      mobileDailyAverage: null,
      overallYearOverYear: parseChangeCell(cells[2]),
      overallMonthOverMonth: parseChangeCell(cells[3]),
      mobileYearOverYear: null,
      mobileMonthOverMonth: null,
    };
  }

  return undefined;
}

function parseNumericCell(value: string): number | null {
  if (value === "-") return null;
  const number = Number(value.replaceAll(",", "").replaceAll("，", ""));
  return Number.isFinite(number) ? number : null;
}

function parseChangeCell(value: string): ChangeMetric {
  if (value === "-") {
    return { percent: null, direction: null };
  }
  const percent = Number(value.replaceAll(/[^0-9.]/g, ""));
  const direction = value.includes("↓") || value.includes("↘")
    ? "down"
    : value.includes("↑") || value.includes("↗")
      ? "up"
      : Number.isFinite(percent) && percent === 0
        ? "flat"
        : Number.isFinite(percent)
          ? "up"
          : null;
  return {
    percent: Number.isFinite(percent) ? percent : null,
    direction,
  };
}
