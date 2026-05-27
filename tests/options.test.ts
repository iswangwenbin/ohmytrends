import { describe, expect, test } from "bun:test";
import { readOptions, withoutFlag } from "../src/options.js";

describe("readOptions", () => {
  test("parses Bun CLI options", () => {
    const options = readOptions([
      "--source",
      "google",
      "--lang",
      "zh",
      "--words",
      "codex app, claude",
      "--geo",
      "US",
      "--range",
      "1y",
      "--raw",
      "true",
      "--format",
      "json",
      "--keep-open",
      "true",
      "--timeout-ms",
      "15000",
    ]);

    expect(options.source).toBe("google");
    expect(options.lang).toBe("zh");
    expect(options.words).toEqual(["codex app", "claude"]);
    expect(options.geo).toBe("US");
    expect(options.range).toBe("today 12-m");
    expect(options.rangeLabel).toBe("1y");
    expect(options.format).toBe("json");
    expect(options.raw).toBe(true);
    expect(options.keepOpen).toBe(true);
    expect(options.timeoutMs).toBe(15000);
  });

  test("reads terminal language from options and environment", () => {
    const previous = process.env.OHMYTRENDS_LANG;
    try {
      process.env.OHMYTRENDS_LANG = "zh";
      expect(readOptions(["--source", "google"]).lang).toBe("zh");
      expect(readOptions(["--source", "google", "--lang", "en"]).lang).toBe("en");
      expect(() => readOptions(["--source", "google", "--lang", "fr"])).toThrow("Invalid --lang");
    } finally {
      if (previous === undefined) {
        delete process.env.OHMYTRENDS_LANG;
      } else {
        process.env.OHMYTRENDS_LANG = previous;
      }
    }
  });

  test("supports all sources with a profile root", () => {
    const options = readOptions(["--profile-dir", "profiles", "--words", "a,b"]);

    expect(options.source).toBe("all");
    expect(options.profileDir).toBe("profiles");
    expect(options.out).toBe("exports/ohmytrends.json");
    expect(options.words).toEqual(["a", "b"]);
    expect(options.rangeLabel).toBe("30d");
    expect(options.baiduMode).toBe("page");
  });

  test("splits keywords with full-width punctuation", () => {
    const options = readOptions(["--source", "google", "--words", "gpt，codex、claude；gemini"]);

    expect(options.words).toEqual(["gpt", "codex", "claude", "gemini"]);
  });

  test("reads Baidu collection mode", () => {
    expect(readOptions(["--source", "baidu"]).baiduMode).toBe("page");
    expect(readOptions(["--source", "baidu", "--baidu-mode", "api"]).baiduMode).toBe("api");
    expect(() => readOptions(["--source", "baidu", "--baidu-mode", "fast"])).toThrow("Invalid --baidu-mode");
  });

  test("reads Google collection mode", () => {
    expect(readOptions(["--source", "google"]).googleMode).toBe("page");
    expect(readOptions(["--source", "google", "--google-mode", "api"]).googleMode).toBe("api");
    expect(() => readOptions(["--source", "google", "--google-mode", "fast"])).toThrow("Invalid --google-mode");
  });

  test("reads Google collection mode from environment", () => {
    const previous = process.env.OHMYTRENDS_GOOGLE_MODE;
    try {
      process.env.OHMYTRENDS_GOOGLE_MODE = "api";
      expect(readOptions(["--source", "google"]).googleMode).toBe("api");
    } finally {
      if (previous === undefined) delete process.env.OHMYTRENDS_GOOGLE_MODE;
      else process.env.OHMYTRENDS_GOOGLE_MODE = previous;
    }
  });

  test("reads dev browser mode defaults from environment variables", () => {
    const previousHeadless = process.env.OHMYTRENDS_HEADLESS;
    const previousKeepOpen = process.env.OHMYTRENDS_KEEP_OPEN;
    try {
      process.env.OHMYTRENDS_HEADLESS = "false";
      process.env.OHMYTRENDS_KEEP_OPEN = "true";

      const options = readOptions(["--source", "google"]);

      expect(options.headless).toBe(false);
      expect(options.keepOpen).toBe(true);
      expect(readOptions(["--source", "google", "--headless", "true", "--keep-open", "false"]).headless).toBe(true);
      expect(readOptions(["--source", "google", "--headless", "true", "--keep-open", "false"]).keepOpen).toBe(false);
    } finally {
      if (previousHeadless === undefined) {
        delete process.env.OHMYTRENDS_HEADLESS;
      } else {
        process.env.OHMYTRENDS_HEADLESS = previousHeadless;
      }
      if (previousKeepOpen === undefined) {
        delete process.env.OHMYTRENDS_KEEP_OPEN;
      } else {
        process.env.OHMYTRENDS_KEEP_OPEN = previousKeepOpen;
      }
    }
  });

  test("reads ohmytrends profile environment variables", () => {
    const previousBaiduPrimary = process.env.BAIDU_INDEX_PROFILE_DIR;
    const previousGooglePrimary = process.env.GOOGLE_TRENDS_PROFILE_DIR;
    const previousBaidu = process.env.OHMYTRENDS_BAIDU_PROFILE_DIR;
    const previousGoogle = process.env.OHMYTRENDS_GOOGLE_PROFILE_DIR;
    try {
      delete process.env.BAIDU_INDEX_PROFILE_DIR;
      delete process.env.GOOGLE_TRENDS_PROFILE_DIR;
      process.env.OHMYTRENDS_BAIDU_PROFILE_DIR = "profiles/env-baidu";
      process.env.OHMYTRENDS_GOOGLE_PROFILE_DIR = "profiles/env-google";

      expect(readOptions(["--source", "baidu"]).profileDir).toBe("profiles/env-baidu");
      expect(readOptions(["--source", "google"]).profileDir).toBe("profiles/env-google");
    } finally {
      if (previousBaidu === undefined) {
        delete process.env.OHMYTRENDS_BAIDU_PROFILE_DIR;
      } else {
        process.env.OHMYTRENDS_BAIDU_PROFILE_DIR = previousBaidu;
      }
      if (previousGoogle === undefined) {
        delete process.env.OHMYTRENDS_GOOGLE_PROFILE_DIR;
      } else {
        process.env.OHMYTRENDS_GOOGLE_PROFILE_DIR = previousGoogle;
      }
      if (previousBaiduPrimary === undefined) {
        delete process.env.BAIDU_INDEX_PROFILE_DIR;
      } else {
        process.env.BAIDU_INDEX_PROFILE_DIR = previousBaiduPrimary;
      }
      if (previousGooglePrimary === undefined) {
        delete process.env.GOOGLE_TRENDS_PROFILE_DIR;
      } else {
        process.env.GOOGLE_TRENDS_PROFILE_DIR = previousGooglePrimary;
      }
    }
  });

  test("defaults Baidu date range to the latest 30 days ending yesterday", () => {
    const options = readOptions(["--source", "baidu", "--words", "微信指数,google"]);

    expect(options.words).toEqual(["微信指数", "google"]);
    expect(options.days).toBe(30);
    expect(options.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(options.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("supports all Baidu ranges through unified --range", () => {
    expect(readOptions(["--source", "baidu", "--range", "4h"]).days).toBe(1);
    expect(readOptions(["--source", "baidu", "--range", "90d"]).rangeLabel).toBe("90d");
    expect(readOptions(["--source", "baidu", "--range", "all"]).startDate).toBeUndefined();
  });

  test("maps unified --range to Google Trends ranges", () => {
    expect(readOptions(["--source", "google"]).range).toBe("today 1-m");
    expect(readOptions(["--source", "google", "--range", "1h"]).range).toBe("now 1-H");
    expect(readOptions(["--source", "google", "--range", "7d"]).range).toBe("now 7-d");
    expect(readOptions(["--source", "google", "--range", "30d"]).range).toBe("today 1-m");
    expect(readOptions(["--source", "google", "--range", "90d"]).range).toBe("today 3-m");
    expect(readOptions(["--source", "google", "--range", "180d"]).range).toBe("today 6-m");
    expect(readOptions(["--source", "google", "--range", "1y"]).range).toBe("today 12-m");
    expect(readOptions(["--source", "google", "--range", "5y"]).range).toBe("today 5-y");
    expect(readOptions(["--source", "google", "--range", "all"]).range).toBe("all");
  });

  test("maps unified --range to Baidu date ranges", () => {
    expect(readOptions(["--source", "baidu", "--range", "1h"]).days).toBe(1);
    expect(readOptions(["--source", "baidu", "--range", "7d"]).days).toBe(7);
    expect(readOptions(["--source", "baidu", "--range", "30d"]).days).toBe(30);
    expect(readOptions(["--source", "baidu", "--range", "90d"]).days).toBe(90);
    expect(readOptions(["--source", "baidu", "--range", "180d"]).days).toBe(180);
    expect(readOptions(["--source", "baidu", "--range", "1y"]).days).toBe(365);
    expect(readOptions(["--source", "baidu", "--range", "all"]).startDate).toBeUndefined();
  });

  test("keeps explicit dates above unified ranges", () => {
    const baidu = readOptions([
      "--source",
      "baidu",
      "--range",
      "30d",
      "--start-date",
      "2026-04-01",
      "--end-date",
      "2026-04-10",
    ]);
    expect(baidu.startDate).toBe("2026-04-01");
    expect(baidu.endDate).toBe("2026-04-10");
    expect(baidu.rangeLabel).toBe("custom");
    expect(readOptions([
      "--source",
      "google",
      "--range",
      "30d",
      "--start-date",
      "2026-04-01",
      "--end-date",
      "2026-04-10",
    ]).range).toBeUndefined();
  });

  test("rejects removed and non-unified range options", () => {
    expect(() => readOptions(["--period", "90d"])).toThrow("--period was removed");
    expect(() => readOptions(["--days", "90"])).toThrow("--days was removed");
    expect(() => readOptions(["--range", "today 12-m"])).toThrow("Invalid --range");
    expect(() => readOptions(["--range", "近90天"])).toThrow("Invalid --range");
  });

  test("rejects invalid numeric options", () => {
    expect(() => readOptions(["--timeout-ms", "later"])).toThrow("Invalid --timeout-ms");
  });

  test("rejects invalid output format", () => {
    expect(() => readOptions(["--format", "xml"])).toThrow("Invalid --format");
  });

  test("rejects more than 5 Google comparison keywords", () => {
    expect(() =>
      readOptions(["--source", "google", "--words", "a,b,c,d,e,f"])
    ).toThrow("Google Trends supports at most 5 keywords");
    expect(() =>
      readOptions(["--source", "all", "--words", "a,b,c,d,e,f"])
    ).toThrow("Google Trends supports at most 5 keywords");
  });
});

describe("withoutFlag", () => {
  test("removes separated and inline flag values", () => {
    expect(withoutFlag(["--profile-dir", "profiles", "--source=google"], "--profile-dir")).toEqual([
      "--source=google",
    ]);
    expect(withoutFlag(["--profile-dir=profiles", "--source", "baidu"], "--profile-dir")).toEqual([
      "--source",
      "baidu",
    ]);
  });
});
