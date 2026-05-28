import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CollectOutput, Options } from "./types.js";

export type DiagnosticsEvent = {
  event: string;
  source: "baidu" | "google";
  mode?: string;
  status?: string;
  dataSource?: string;
  words?: string[];
  keywords?: string[];
  range?: string;
  startDate?: string;
  endDate?: string;
  headless?: boolean;
  retry?: boolean;
  fallback?: string;
  reason?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export function writeDiagnostics(options: Options, event: DiagnosticsEvent): void {
  const filePath = options.diagnosticsLogPath;
  if (!filePath) return;
  if (options.diagnosticsLogDefault && !isDefaultLogEvent(event)) return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
      words: event.words || options.words,
      keywords: event.keywords || event.words || options.words,
      range: event.range || options.rangeLabel || options.range,
      startDate: event.startDate || options.startDate,
      endDate: event.endDate || options.endDate,
      headless: event.headless ?? options.headless,
    })}\n`, "utf8");
  } catch {
    // Diagnostics must never break data collection.
  }
}

function isDefaultLogEvent(event: DiagnosticsEvent): boolean {
  return event.event.endsWith("_intercept_response");
}

export function collectOutputDiagnostics(output: CollectOutput): Record<string, unknown> {
  if (output.source === "baidu") {
    return {
      status: output.status,
      reason: output.reason,
      unavailableWords: output.unavailableWords || [],
      searchPoints: pointCount(output.indices?.search?.trends),
      feedPoints: pointCount(output.indices?.feed?.trends),
      searchError: output.indices?.search?.error,
      feedError: output.indices?.feed?.error,
    };
  }
  return {
    status: output.status,
    reason: output.reason,
    trendPoints: pointCount(output.trends),
    relatedQueries: output.relatedQueries
      ? Object.fromEntries(Object.entries(output.relatedQueries).map(([word, queries]) => [
        word,
        { top: queries.top.length, rising: queries.rising.length },
      ]))
      : undefined,
    error: output.error,
  };
}

function pointCount(trends: { word: string; points: unknown[] }[] | undefined): Record<string, number> {
  return Object.fromEntries((trends || []).map((trend) => [
    trend.word,
    trend.points.length,
  ]));
}
