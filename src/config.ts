export const DEFAULT_WORDS = ["codex", "claude"];
export const DEFAULT_HOME_URL = "https://index.baidu.com/v2/index.html#/";
export const DEFAULT_GOOGLE_TRENDS_URL = "https://trends.google.com/trends/explore";
export const DEFAULT_BAIDU_PROFILE_DIR = "profiles/baidu";
export const DEFAULT_GOOGLE_PROFILE_DIR = "profiles/google";
export const DEFAULT_OUT = "exports/baidu-index.json";
export const DEFAULT_DIAGNOSTICS_LOG = "logs/events.jsonl";
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_BAIDU_DAYS = 30;
export const DEFAULT_BAIDU_MIN_INTERVAL_MS = 15_000;
export const DEFAULT_BAIDU_COOLDOWN_MS = 2 * 60_000;
export const DEFAULT_QUEUE_DB = "data/queue.sqlite";

export const DEFAULT_URL = buildBaiduTrendUrl(DEFAULT_WORDS);

export function buildBaiduTrendUrl(words: string[]): string {
  const firstWord = words[0] || "";
  const encodedFirstWord = encodeURIComponent(firstWord);
  const encodedWords = encodeURIComponent(words.join(","));
  return `https://index.baidu.com/v2/main/index.html#/trend/${encodedFirstWord}?words=${encodedWords}`;
}
