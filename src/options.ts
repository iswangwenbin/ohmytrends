import {
  buildBaiduTrendUrl,
  DEFAULT_BAIDU_PROFILE_DIR,
  DEFAULT_GOOGLE_PROFILE_DIR,
  DEFAULT_LOGIN_TIMEOUT_MS,
  DEFAULT_OUT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WORDS,
} from "./config.js";
import { readLanguage } from "./i18n.js";
import type { BaiduCollectMode, GoogleCollectMode, Options, OutputFormat, Source, SourceOption } from "./types.js";

const DEFAULT_RANGE = "30d";
const VALID_RANGES = ["1h", "4h", "1d", "7d", "30d", "90d", "180d", "1y", "5y", "all"] as const;
type UnifiedRange = typeof VALID_RANGES[number];

export function readOptions(args: string[]): Options {
  rejectRemovedFlags(args);
  const words = splitCsv(readFlag(args, "--words")).filter(Boolean);
  const source = readSource(args);
  const resolvedWords = words.length > 0 ? words : DEFAULT_WORDS;
  validateWords(source, resolvedWords);
  const effectiveSource = source === "all" ? "baidu" : source;
  const dateOptions = readDateOptions(args, effectiveSource);
  const explicitDateOptions = readExplicitDateOptions(args);
  const rangeLabel = explicitDateOptions.startDate || explicitDateOptions.endDate
    ? "custom"
    : readUnifiedRange(args) || DEFAULT_RANGE;
  const profileDir = readFlag(args, "--profile-dir") ||
    profileDirFromEnvironment(source) ||
    defaultProfileDir(source);
  return {
    source,
    lang: readLanguage(args),
    url: readFlag(args, "--url") || buildBaiduTrendUrl(resolvedWords),
    words: resolvedWords,
    profileDir,
    out: readFlag(args, "--out") ||
      (source === "all" ? "exports/ohmytrends.json" : source === "google" ? "exports/google-trends.json" : DEFAULT_OUT),
    format: readOutputFormat(args),
    raw: readFlag(args, "--raw") === "true",
    headless: readBooleanOption(args, "--headless", "OHMYTRENDS_HEADLESS", true),
    keepOpen: readBooleanOption(args, "--keep-open", "OHMYTRENDS_KEEP_OPEN", false),
    timeoutMs: readPositiveNumber(
      readFlag(args, "--timeout-ms") || process.env.BAIDU_INDEX_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      "--timeout-ms",
    ),
    loginTimeoutMs: readPositiveNumber(
      readFlag(args, "--login-timeout-ms") ||
        process.env.BAIDU_INDEX_LOGIN_TIMEOUT_MS,
      DEFAULT_LOGIN_TIMEOUT_MS,
      "--login-timeout-ms",
    ),
    startDate: dateOptions.startDate,
    endDate: dateOptions.endDate,
    days: dateOptions.days,
    range: readGoogleRange(args, explicitDateOptions),
    rangeLabel,
    baiduMode: readBaiduCollectMode(args),
    googleMode: readGoogleCollectMode(args),
    geo: readFlag(args, "--geo") || "",
    area: readFlag(args, "--area") || "0",
  };
}

function readBaiduCollectMode(args: string[]): BaiduCollectMode {
  const mode = readFlag(args, "--baidu-mode") || process.env.OHMYTRENDS_BAIDU_MODE || "page";
  if (mode === "page" || mode === "api") return mode;
  throw new Error(`Invalid --baidu-mode: ${mode}. Expected page or api`);
}

function readGoogleCollectMode(args: string[]): GoogleCollectMode {
  const mode = readFlag(args, "--google-mode") || process.env.OHMYTRENDS_GOOGLE_MODE || "page";
  if (mode === "page" || mode === "api") return mode;
  throw new Error(`Invalid --google-mode: ${mode}. Expected page or api`);
}

function readOutputFormat(args: string[]): OutputFormat {
  const format = readFlag(args, "--format") || "table";
  if (format === "table" || format === "json") return format;
  throw new Error(`Invalid --format: ${format}. Expected table or json`);
}

export function readFlag(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

export function withoutFlag(args: string[], name: string): string[] {
  const prefix = `${name}=`;
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      index += 1;
      continue;
    }
    if (arg.startsWith(prefix)) continue;
    result.push(arg);
  }
  return result;
}

function profileDirFromEnvironment(source: SourceOption): string | undefined {
  if (source === "all") return undefined;
  if (source === "google") {
    return process.env.GOOGLE_TRENDS_PROFILE_DIR || process.env.OHMYTRENDS_GOOGLE_PROFILE_DIR;
  }
  return process.env.BAIDU_INDEX_PROFILE_DIR || process.env.OHMYTRENDS_BAIDU_PROFILE_DIR;
}

function defaultProfileDir(source: SourceOption): string {
  if (source === "all") return "profiles";
  return source === "google" ? DEFAULT_GOOGLE_PROFILE_DIR : DEFAULT_BAIDU_PROFILE_DIR;
}

function readSource(args: string[]): SourceOption {
  const source = readFlag(args, "--source") || "all";
  if (source === "baidu" || source === "google" || source === "all") return source;
  throw new Error(`Invalid --source: ${source}. Expected baidu, google, or all`);
}

function rejectRemovedFlags(args: string[]): void {
  const removed = ["--period", "--days"].find((flag) => hasFlag(args, flag));
  if (removed === "--period") {
    throw new Error("--period was removed. Use --range instead");
  }
  if (removed === "--days") {
    throw new Error("--days was removed. Use --range instead");
  }
}

function hasFlag(args: string[], name: string): boolean {
  const prefix = `${name}=`;
  return args.some((arg) => arg === name || arg.startsWith(prefix));
}

function splitCsv(value: string | undefined): string[] {
  return (value || "")
    .split(/[,\uFF0C\u3001\uFF1B;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateWords(source: SourceOption, words: string[]): void {
  if ((source === "google" || source === "all") && words.length > 5) {
    throw new Error("Google Trends supports at most 5 keywords per comparison");
  }
}

function readPositiveNumber(value: string | undefined, fallback: number, label: string): number {
  if (!value) return fallback;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  throw new Error(`Invalid ${label}: ${value}. Expected a positive number`);
}

function readBooleanOption(args: string[], flag: string, envName: string, fallback: boolean): boolean {
  const flagValue = readFlag(args, flag);
  if (flagValue !== undefined) return parseBoolean(flagValue, flag);
  const envValue = process.env[envName];
  if (envValue !== undefined) return parseBoolean(envValue, envName);
  return fallback;
}

function parseBoolean(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid ${label}: ${value}. Expected true or false`);
}

function readDateOptions(
  args: string[],
  source: Source,
): { startDate?: string; endDate?: string; days?: number } {
  const { startDate, endDate } = readExplicitDateOptions(args);
  if (startDate || endDate) return { startDate, endDate };

  if (source !== "baidu") return {};

  const range = readUnifiedRange(args) || DEFAULT_RANGE;
  if (range === "all") return {};

  const resolvedDays = rangeToBaiduDays(range);
  const resolvedEndDate = formatDate(addDays(new Date(), -1));
  return {
    startDate: formatDate(addDays(parseDate(resolvedEndDate), -(resolvedDays - 1))),
    endDate: resolvedEndDate,
    days: resolvedDays,
  };
}

function readExplicitDateOptions(args: string[]): { startDate?: string; endDate?: string } {
  return {
    startDate: readFlag(args, "--start-date"),
    endDate: readFlag(args, "--end-date"),
  };
}

function readGoogleRange(args: string[], dateOptions: { startDate?: string; endDate?: string }): string | undefined {
  if (dateOptions.startDate || dateOptions.endDate) return undefined;
  return rangeToGoogleRange(readUnifiedRange(args) || DEFAULT_RANGE);
}

function readUnifiedRange(args: string[]): UnifiedRange | undefined {
  const range = readFlag(args, "--range");
  if (range) return normalizeUnifiedRange(range);
  return undefined;
}

function normalizeUnifiedRange(value: string): UnifiedRange {
  const normalized = value.trim().toLowerCase();
  if (VALID_RANGES.includes(normalized as UnifiedRange)) return normalized as UnifiedRange;
  throw new Error(`Invalid --range: ${value}. Expected one of ${VALID_RANGES.join(", ")}`);
}

function rangeToGoogleRange(range: UnifiedRange): string {
  const ranges: Record<string, string> = {
    "1h": "now 1-H",
    "4h": "now 4-H",
    "1d": "now 1-d",
    "7d": "now 7-d",
    "30d": "today 1-m",
    "90d": "today 3-m",
    "180d": "today 6-m",
    "1y": "today 12-m",
    "5y": "today 5-y",
    "all": "all",
  };
  return ranges[range];
}

function rangeToBaiduDays(range: Exclude<UnifiedRange, "all">): number {
  const hours = range.match(/^(\d+)h$/);
  if (hours) return 1;
  const days = range.match(/^(\d+)d$/);
  if (days?.[1]) return Number(days[1]);
  const years = range.match(/^(\d+)y$/);
  if (years?.[1]) return Number(years[1]) * 365;
  return 30;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
