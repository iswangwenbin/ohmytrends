import { describe, expect, test } from "bun:test";
import {
  findGoogleWidget,
  googleExplorePageUrl,
  googleOverviewFromTrends,
  googleRelatedQueriesFromResponse,
  googleTimelineToTrends,
  redactGoogleApiUrl,
  selectActiveGoogleLoginPage,
  selectGoogleTimelineCapture,
  stripGoogleJsonPrefix,
} from "../src/google.js";
import { loginWindowClosedMessage } from "../src/browser-utils.js";
import type { BrowserContextLike, PageLike } from "../src/types.js";

describe("Google Trends helpers", () => {
  test("strips Google's JSON prefix", () => {
    expect(stripGoogleJsonPrefix(")]}',\n{\"ok\":true}")).toBe("{\"ok\":true}");
  });

  test("converts timeline data into keyword trends", () => {
    const trends = googleTimelineToTrends(["codex", "claude"], [
      { time: "1716336000", value: [10, 20], hasData: [true, true] },
      { time: "1716422400", value: [0, 30], hasData: [false, true] },
    ]);

    expect(trends[0]?.points).toEqual([
      { date: "2024-05-22", all: 10, pc: null, wise: null },
      { date: "2024-05-23", all: null, pc: null, wise: null },
    ]);
    expect(googleOverviewFromTrends(["claude"], trends)[0]?.overallDailyAverage).toBe(25);
  });

  test("builds Google Trends explore URL with comma-joined keywords", () => {
    // Google Trends parses keywords from a single comma-separated `q` value
    // (e.g. `?q=gpt,codex`). Repeated `q=` parameters are silently dropped and
    // the page opens with no keyword, so this format is load-bearing.
    const url = new URL(googleExplorePageUrl({
      source: "google",
      url: "",
      words: ["codex app", "claude", "gemini"],
      profileDir: "profiles/google",
      out: "exports/google-trends.json",
      raw: false,
      headless: true,
      keepOpen: false,
      timeoutMs: 60_000,
      loginTimeoutMs: 300_000,
      range: "today 12-m",
      geo: "US",
      area: "0",
    }));

    expect(url.searchParams.getAll("q")).toEqual(["codex app,claude,gemini"]);
    expect(url.searchParams.get("q")).toBe("codex app,claude,gemini");
    expect(url.searchParams.get("geo")).toBe("US");
    expect(url.searchParams.get("date")).toBe("today 12-m");
  });

  test("redacts Google API tokens", () => {
    expect(redactGoogleApiUrl("https://trends.google.com/x?req=1&token=secret-value")).toBe(
      "https://trends.google.com/x?req=1&token=%5Bredacted%5D",
    );
    expect(redactGoogleApiUrl("/x?token=secret&req=1")).toBe("/x?token=[redacted]&req=1");
  });

  test("parses related queries from ranked lists", () => {
    expect(googleRelatedQueriesFromResponse({
      default: {
        rankedList: [
          {
            rankedKeyword: [
              { query: "gemini ai", value: 100, formattedValue: "100" },
            ],
          },
          {
            rankedKeyword: [
              { query: "nano banana gemini", value: 5000, formattedValue: "Breakout" },
            ],
          },
        ],
      },
    })).toEqual({
      top: [{ query: "gemini ai", value: 100, formattedValue: "100", link: undefined }],
      rising: [{ query: "nano banana gemini", value: 5000, formattedValue: "Breakout", link: undefined }],
    });
  });

  test("finds Google widgets with suffixed ids", () => {
    expect(findGoogleWidget([{ id: "RELATED_QUERIES_0", token: "token", request: {} }], "RELATED_QUERIES")?.token)
      .toBe("token");
  });

  test("ignores empty captured timeline responses", () => {
    expect(selectGoogleTimelineCapture([
      {
        url: "https://trends.google.com/trends/api/widgetdata/multiline",
        response: { default: { timelineData: [] } },
      },
      {
        url: "https://trends.google.com/trends/api/widgetdata/multiline?empty=1",
        response: { default: { timelineData: [{ time: "1716336000", value: [], hasData: [] }] } },
      },
    ], ["gpt", "codex"])).toBeUndefined();

    expect(selectGoogleTimelineCapture([
      {
        url: "https://trends.google.com/trends/api/widgetdata/multiline?ok=1",
        response: { default: { timelineData: [{ time: "1716336000", value: [10, 20], hasData: [true, true] }] } },
      },
    ], ["gpt", "codex"])?.url).toContain("ok=1");
  });

  test("does not treat unrelated blank pages as an active Google login window", () => {
    const closedLoginPage = { isClosed: () => true, url: () => "https://accounts.google.com/" } as PageLike;
    const blankPage = { isClosed: () => false, url: () => "about:blank" } as PageLike;
    const context = { pages: () => [blankPage] } as BrowserContextLike;

    expect(() => selectActiveGoogleLoginPage(context, closedLoginPage)).toThrow(loginWindowClosedMessage("Google"));
  });
});
