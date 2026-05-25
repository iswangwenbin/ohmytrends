import type { BaiduIndexKind, ChangeMetric, CollectOutput, IndexPoint, Options, RelatedQueries, Source } from "./types.js";

export type UnifiedMultiSourceOutput = {
  schemaVersion: 1;
  source: "all";
  status: UnifiedOutput["status"];
  capturedAt: string;
  query: {
    keywords: string[];
    range: string;
    startDate: string | null;
    endDate: string | null;
  };
  results: UnifiedOutput[];
  messages: string[];
};

export type UnifiedOutput = {
  schemaVersion: 1;
  source: Source;
  status: "ok" | "partial" | "no_data" | "error";
  capturedAt: string;
  query: {
    keywords: string[];
    range: string;
    startDate: string | null;
    endDate: string | null;
    region: string | null;
  };
  results: UnifiedKeywordResult[];
  messages: string[];
  sourceMeta: {
    sourceUrl: string;
    apiUrls: Record<string, string>;
  };
  raw?: unknown;
};

export type UnifiedKeywordResult = {
  keyword: string;
  status: "ok" | "no_data" | "unavailable" | "error";
  search: UnifiedMetric | null;
  feed: UnifiedMetric | null;
  relatedQueries: UnifiedRelatedQueries | null;
  message: string | null;
};

export type UnifiedMetric = {
  unit: "relative" | "index";
  average: number | null;
  mobileAverage: number | null;
  points: UnifiedPoint[];
  yearOverYear?: ChangeMetric | null;
  monthOverMonth?: ChangeMetric | null;
};

export type UnifiedPoint = {
  date: string;
  value: number | null;
  pc: number | null;
  mobile: number | null;
};

export type UnifiedRelatedQueries = {
  top: UnifiedRelatedQuery[];
  rising: UnifiedRelatedQuery[];
};

export type UnifiedRelatedQuery = {
  query: string;
  value: number | null;
  label: string;
  link?: string;
};

export function toUnifiedOutput(output: CollectOutput, options: Options): UnifiedOutput {
  const unavailable = new Set(output.unavailableWords || []);
  const messages = outputMessages(output);
  return {
    schemaVersion: 1,
    source: output.source,
    status: unifiedStatus(output, unavailable),
    capturedAt: output.capturedAt,
    query: {
      keywords: output.words,
      range: inferRange(options),
      startDate: options.startDate || null,
      endDate: options.endDate || null,
      region: output.source === "google" ? options.geo || null : options.area || null,
    },
    results: output.words.map((word) => unifiedKeywordResult(output, word, unavailable)),
    messages,
    sourceMeta: {
      sourceUrl: output.sourceUrl,
      apiUrls: unifiedApiUrls(output),
    },
    raw: output.raw,
  };
}

export function toUnifiedMultiSourceOutput(results: UnifiedOutput[], options: Options): UnifiedMultiSourceOutput {
  const hasCustomDates = options.rangeLabel === "custom";
  return {
    schemaVersion: 1,
    source: "all",
    status: combinedStatus(results),
    capturedAt: new Date().toISOString(),
    query: {
      keywords: options.words,
      range: inferRange(options),
      startDate: hasCustomDates ? options.startDate || null : null,
      endDate: hasCustomDates ? options.endDate || null : null,
    },
    results,
    messages: [...new Set(results.flatMap((result) => result.messages))],
  };
}

function unifiedKeywordResult(
  output: CollectOutput,
  keyword: string,
  unavailable: Set<string>,
): UnifiedKeywordResult {
  const search = metricFor(output, keyword, "search");
  const feed = output.source === "baidu" ? metricFor(output, keyword, "feed") : null;
  const message = unavailable.has(keyword) ? unavailableMessage(output.source) : null;
  return {
    keyword,
    status: keywordStatus(search, feed, unavailable.has(keyword)),
    search,
    feed,
    relatedQueries: relatedQueriesFor(output.relatedQueries?.[keyword]),
    message,
  };
}

function metricFor(output: CollectOutput, keyword: string, kind: BaiduIndexKind): UnifiedMetric | null {
  const overview = overviewFor(output, keyword, kind);
  const trend = trendFor(output, keyword, kind);
  if (!overview && !trend) return null;
  return {
    unit: output.source === "google" ? "relative" : "index",
    average: overview?.overallDailyAverage ?? averagePointValue(trend?.points, "all"),
    mobileAverage: overview?.mobileDailyAverage ?? averagePointValue(trend?.points, "wise"),
    points: (trend?.points || []).map(unifiedPoint),
    yearOverYear: overview?.overallYearOverYear ?? null,
    monthOverMonth: overview?.overallMonthOverMonth ?? null,
  };
}

function overviewFor(output: CollectOutput, keyword: string, kind: BaiduIndexKind) {
  const rows = output.source === "baidu"
    ? output.indices?.[kind]?.overview || []
    : output.overview;
  return rows.find((row) => row.keyword === keyword);
}

function trendFor(output: CollectOutput, keyword: string, kind: BaiduIndexKind) {
  const trends = output.source === "baidu"
    ? output.indices?.[kind]?.trends || []
    : output.trends;
  return trends.find((trend) => trend.word === keyword);
}

function unifiedPoint(point: IndexPoint): UnifiedPoint {
  return {
    date: point.date,
    value: point.all,
    pc: point.pc,
    mobile: point.wise,
  };
}

function averagePointValue(points: IndexPoint[] | undefined, key: "all" | "wise"): number | null {
  const values = (points || [])
    .map((point) => point[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function relatedQueriesFor(related: RelatedQueries | undefined): UnifiedRelatedQueries | null {
  if (!related) return null;
  return {
    top: related.top.map((item) => ({
      query: item.query,
      value: item.value,
      label: item.formattedValue,
      link: item.link,
    })),
    rising: related.rising.map((item) => ({
      query: item.query,
      value: item.value,
      label: item.formattedValue,
      link: item.link,
    })),
  };
}

function keywordStatus(search: UnifiedMetric | null, feed: UnifiedMetric | null, unavailable: boolean) {
  if (unavailable) return "unavailable";
  const hasData = [search, feed].some((metric) =>
    metric && (metric.average !== null || metric.mobileAverage !== null || metric.points.some((point) => point.value !== null)),
  );
  return hasData ? "ok" : "no_data";
}

function unifiedStatus(output: CollectOutput, unavailable: Set<string>): UnifiedOutput["status"] {
  if (output.error && output.status === "no_data") return "error";
  if (unavailable.size > 0 && unavailable.size < output.words.length) return "partial";
  if (unavailable.size > 0 && unavailable.size === output.words.length) return "no_data";
  return output.status;
}

function combinedStatus(results: UnifiedOutput[]): UnifiedOutput["status"] {
  if (results.some((result) => result.status === "error")) return "error";
  if (results.some((result) => result.status === "partial")) return "partial";
  const ok = results.filter((result) => result.status === "ok").length;
  if (ok === results.length) return "ok";
  if (ok > 0) return "partial";
  return "no_data";
}

function outputMessages(output: CollectOutput): string[] {
  const messages = [
    output.reason,
    output.error,
    output.unavailableWords?.length ? `${output.unavailableWords.length} 个关键词不可用或未收录` : undefined,
  ];
  return [...new Set(messages.filter((message): message is string => Boolean(message)))];
}

function unifiedApiUrls(output: CollectOutput): Record<string, string> {
  if (output.apiUrls) {
    return Object.fromEntries(Object.entries(output.apiUrls).filter((entry): entry is [string, string] => Boolean(entry[1])));
  }
  return { main: output.apiUrl };
}

function inferRange(options: Options): string {
  if (options.rangeLabel) return options.rangeLabel;
  if (options.days) return `${options.days}d`;
  if (options.startDate || options.endDate) return "custom";
  if (options.range) return options.range;
  return "30d";
}

function unavailableMessage(source: Source): string {
  return source === "baidu" ? "关键词未被百度指数收录" : "关键词不可用或没有数据";
}
