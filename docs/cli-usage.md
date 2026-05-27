# ohmytrends CLI Usage

English | [简体中文](cli-usage.zh-CN.md)

Detailed CLI reference for `ohmytrends`. See the project [README](../README.md)
for installation and quick start.

## Common Examples

Google only:

```bash
bun src/cli.ts get --source google --words "gemini" --geo US --range 1y
```

Baidu only:

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --range 30d
```

Build a local binary:

```bash
bun run build
./bin/ohmytrends get --words "gemini,claude"
```

The built binary is self-contained, but it does not include your browser
profile, cookies, output files, or Chromium cache. First-time use still requires
manual login:

```bash
./bin/ohmytrends login
```

For debugging a visible browser session:

```bash
./bin/ohmytrends get --source google --words "gemini" --headless false --keep-open true
```

The CLI writes JSON to `--out` and prints a terminal summary table.

## Commands

```bash
bun src/cli.ts help
./bin/ohmytrends help
```

Run without a command to open the Clack menu:

```bash
bun src/cli.ts
./bin/ohmytrends
```

During development, the same interactive menu can be launched with:

```bash
bun run dev
```

`bun run dev` uses the default headless collection mode. Use `bun run dev:debug`
when you want visible browser windows and keep-open debugging:

```bash
bun run dev:debug
```

In non-interactive environments, or when `OHMYTRENDS_NO_PROMPTS=true` is set, the
bare command falls back to the normal help output.

The interactive flow is split into two steps. Step 1 only prepares login state
by opening a visible browser for manual sign-in.

Step 2 is shown only after Baidu and Google sessions are both ready. It contains
runtime actions such as collection and the HTTP API.

### `login`

Open a Clack login flow, launch a visible browser, and store an
authenticated profile:

```bash
bun src/cli.ts login --source google
bun src/cli.ts login --source baidu
bun src/cli.ts login --source all
```

Run login for both services:

```bash
bun src/cli.ts login
```

When `login` is run without `--source`, `--profile-dir ./profiles` is treated as
a root directory and sessions are stored in:

- `./profiles/baidu`
- `./profiles/google`

The login command runs sources sequentially so only one manual-login browser is
active at a time. In non-interactive environments it falls back to plain log
output. Set `OHMYTRENDS_NO_PROMPTS=true` to force the plain login flow.

### `logout`

Remove saved browser sessions:

```bash
bun src/cli.ts logout
bun src/cli.ts logout google
bun src/cli.ts logout baidu
bun src/cli.ts logout all
```

Like `login`, running `logout` without a target treats `--profile-dir` as a
root directory and removes both `baidu` and `google` child profiles. Use this
when you want to force a fresh manual login.

### `get`

Collect data from a source:

```bash
bun src/cli.ts get --source google --words "gemini"
bun src/cli.ts get --source baidu --words "微信指数"
```

Use `--source all` to run Baidu and Google with the same words and range:

```bash
bun src/cli.ts get --source all --words "gemini,claude" --format json
```

Main options:

| Option | Applies to | Default | Description |
| --- | --- | --- | --- |
| `--source baidu|google|all` | Both | `all` | Select one source or run both sources with `all`. |
| `--words "a,b,c"` | Both | `codex,claude` | Comma-separated keywords. |
| `--out path.json` | Both | Source-specific, or `exports/ohmytrends.json` for `all` | JSON output path. |
| `--profile-dir path` | Both | Source-specific, or `profiles` for `all` | Persistent browser profile path. For `all`, this is treated as a root containing `baidu` and `google`. |
| `--format table|json` | Both | `table` | Stdout format. Use `json` for scripts and integrations. |
| `--headless false` | Both | `true` | Always show the browser window. |
| `--keep-open true` | Both | `false` | Keep a visible browser open after collection until `Ctrl+C`. |
| `--login-timeout-ms 300000` | Both | `300000` | Manual login polling timeout. |
| `--timeout-ms 60000` | Both | `60000` | Page/action timeout. |
| `--raw true` | Both | `false` | Include raw third-party API responses. Use only for local debugging. |
| `--start-date YYYY-MM-DD` | Both | Source-specific | Custom range start. |
| `--end-date YYYY-MM-DD` | Both | Source-specific | Custom range end. |
| `--range 1h|4h|1d|7d|30d|90d|180d|1y|5y|all` | Both | `30d` | Unified source-neutral range. |
| `--area 0` | Baidu | `0` | Baidu area code. |
| `--baidu-mode page|api` | Baidu | `page` | Baidu collection mode. `page` navigates to the trend URL and intercepts the page's own search/feed index XHRs (falls back to `api` automatically on failure); `api` calls the search/feed index endpoints directly from the authenticated context. |
| `--google-mode page|api` | Google | `page` | Google collection mode. `page` opens the explore UI and intercepts the responses (matches real-user traffic, falls back to `api` automatically on failure or empty data); `api` calls the internal Trends APIs directly from the authenticated page (faster but more easily rate-limited). |
| `--geo US` | Google | Global | Google Trends geographic region. |
| `--lang en|zh` | Both | System locale | Terminal language. |

Removed options:

| Removed option | Replacement |
| --- | --- |
| `--period` | Use `--range`. |
| `--days` | Use `--range`. |
| Google native ranges like `today 12-m` | Use `--range 1y`. |
| Baidu native ranges like `近90天` | Use `--range 90d`. |

Environment variables:

| Variable | Description |
| --- | --- |
| `BAIDU_INDEX_PROFILE_DIR` | Baidu profile directory. |
| `GOOGLE_TRENDS_PROFILE_DIR` | Google profile directory. |
| `OHMYTRENDS_BAIDU_PROFILE_DIR` | Alternative Baidu profile directory. |
| `OHMYTRENDS_GOOGLE_PROFILE_DIR` | Alternative Google profile directory. |
| `OHMYTRENDS_LANG` | Terminal language. Use `en` or `zh`. |
| `OHMYTRENDS_HEADLESS` | Default browser visibility. Use `false` for visible browser debugging. |
| `OHMYTRENDS_KEEP_OPEN` | Default keep-open behavior. Use `true` to keep visible browser windows open after collection. |
| `OHMYTRENDS_NO_PROMPTS` | Set to `true` to disable interactive Clack prompts. |
| `OHMYTRENDS_BAIDU_MODE` | Default Baidu collection mode (`page` or `api`). |
| `OHMYTRENDS_GOOGLE_MODE` | Default Google collection mode (`page` or `api`). |
| `OHMYTRENDS_GOOGLE_TIMING` | Set to `true` to print per-stage timings for Google collection (for diagnosing slow runs). |
| `OHMYTRENDS_HOST` | Default HTTP API host. |
| `OHMYTRENDS_PORT` | Default HTTP API port. |
| `BAIDU_INDEX_TIMEOUT_MS` | Default action timeout. |
| `BAIDU_INDEX_LOGIN_TIMEOUT_MS` | Default login polling timeout. |

### `serve`

Start the Bun + Elysia HTTP API server:

```bash
bun src/cli.ts serve --host 127.0.0.1 --port 3000
./bin/ohmytrends serve --host 127.0.0.1 --port 3000
```

`bun run start` is a shortcut for `bun src/cli.ts serve` with defaults.

Open `http://127.0.0.1:3000` for a built-in client example page. It requests
`/api/trends` with `fetch()` and renders the returned unified JSON.

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Query with GET:

```bash
curl "http://127.0.0.1:3000/api/trends?source=google&words=gemini&geo=US&range=30d"
```

Query with POST:

```bash
curl -X POST http://127.0.0.1:3000/api/trends \
  -H "content-type: application/json" \
  -d '{"source":"all","words":["gemini","claude"],"range":"30d"}'
```

The API returns the same unified JSON shape as `get --format json`. See
[`json-output.md`](json-output.md) for the response contract.

First-time use may still require manual login. For server usage, initialize
sessions before starting the API:

```bash
./bin/ohmytrends login
./bin/ohmytrends serve --port 3000
```

Supported request fields match the CLI option names in camelCase:
`source`, `words`, `range`, `startDate`, `endDate`, `geo`, `area`,
`profileDir`, `raw`, `headless`, `keepOpen`, `timeoutMs`, and
`loginTimeoutMs`. The API also accepts `lang` (`en` or `zh`) for localized
runtime messages.

## Login Flow

The CLI opens a persistent browser context. By default collection runs headless.

If a service is not logged in:

1. The CLI reopens the task in a visible browser window.
2. You log in manually.
3. The CLI polls login state for up to 5 minutes by default.
4. After login is detected, the task continues automatically.

The menu and collection commands verify login by opening the saved profile, not
just by checking whether cookie files exist. This avoids treating expired or
non-portable imported sessions as valid account state.

When the browser is visible, `ohmytrends` injects a status overlay in the
bottom-right corner of every page. The overlay shows Chinese progress messages,
switches from `运行中` to `已完成` when collection finishes, and uses `需处理` for
error or attention states.

Keep the browser open for debugging:

```bash
bun src/cli.ts get --source google --words "gemini" --headless false --keep-open true
```

Close the kept-open browser by pressing `Ctrl+C` in the terminal.

## Google Trends Usage

### Basic Collection

```bash
bun src/cli.ts get --source google --words "gemini" --out exports/google-trends.json
```

### Multiple Keywords

```bash
bun src/cli.ts get --source google --words "codex app,claude,gemini"
```

Google Trends supports up to 5 comparison keywords in one request. Timeline
data is collected as a comparison. Related queries are collected per keyword and
returned under `relatedQueries`.

### Collection Mode

Google defaults to `--google-mode page`. Page mode opens the Trends explore UI
and intercepts the responses the page itself makes. The request pattern matches
a real user and is far less likely to trip anti-bot heuristics. If page mode
returns no data or fails, the collector **automatically falls back to `api`
mode** on the same authenticated page.

```bash
bun src/cli.ts get --source google --words "gemini" --google-mode page
```

`api` mode calls the internal `/trends/api/explore`, `widgetdata/multiline`,
and `widgetdata/relatedsearches` endpoints directly. It is fastest and returns
deterministic, per-keyword related queries, but headless sessions are more
likely to be silently rate-limited (HTTP 200 with empty data). API mode itself
retries once on empty payloads.

```bash
bun src/cli.ts get --source google --words "gemini" --google-mode api
```

### Google Date Ranges

Use `--range` for source-neutral ranges. If no range is provided, Google uses
the default `--range 30d`.

| Range | Google Trends range |
| --- | --- |
| `1h` | `now 1-H` |
| `4h` | `now 4-H` |
| `1d` | `now 1-d` |
| `7d` | `now 7-d` |
| `30d` | `today 1-m` |
| `90d` | `today 3-m` |
| `180d` | `today 6-m` |
| `1y` | `today 12-m` |
| `5y` | `today 5-y` |
| `all` | `all` |

Example:

```bash
bun src/cli.ts get --source google --words "gemini" --range 90d
```

You can also use:

```bash
bun src/cli.ts get --source google --words "gemini" --start-date 2026-04-23 --end-date 2026-05-22
```

When explicit dates are provided, `query.range` in JSON output is `custom`.

### Google Geographic Regions

`--geo` is passed to Google Trends.

Common values:

| Geo | Meaning |
| --- | --- |
| empty / omitted | Worldwide |
| `US` | United States |
| `CN` | China |
| `HK` | Hong Kong |
| `TW` | Taiwan |
| `JP` | Japan |
| `KR` | South Korea |
| `GB` | United Kingdom |
| `DE` | Germany |
| `FR` | France |
| `IN` | India |
| `SG` | Singapore |
| `US-CA` | California, United States |
| `US-NY` | New York, United States |
| `GB-ENG` | England |

Example:

```bash
bun src/cli.ts get --source google --words "gemini" --geo US --range 1y
```

Google Trends values are relative 0-100 interest scores. They are not absolute
search volume.

## Baidu Index Usage

### Basic Collection

```bash
bun src/cli.ts get --source baidu --words "微信指数" --out exports/baidu-index.json
```

### Multiple Keywords

```bash
bun src/cli.ts get --source baidu --words "微信指数,google"
```

### Collection Mode

Baidu defaults to `--baidu-mode page`. Page mode navigates directly to the
trend URL and intercepts the search/feed index XHRs the page itself fires.
The request pattern matches what a real Baidu Index user would generate and
is less likely to trip anti-bot heuristics than constructing the API URLs by
hand. If page mode fails, the collector falls back to `api` mode.

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --baidu-mode page
```

`api` mode skips the trend page entirely and calls the search/feed index
endpoints directly from the authenticated context. Marginally faster on the
happy path but more likely to hit Baidu's abnormal-access warning on a cold
session.

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --baidu-mode api
```

If Baidu reports that a keyword is not indexed, the CLI:

1. Shows a warning in the terminal.
2. Shows a warning in the status overlay when visible.
3. Removes unavailable words from the live Baidu query.
4. Returns default `0` values for unavailable words in the final output.
5. Adds the words to `unavailableWords`.

### Baidu Date Ranges

By default, Baidu collection uses `--range 30d`, which means the latest 30 days
ending yesterday.

Use `--range` for source-neutral ranges:

| Range | Baidu behavior |
| --- | --- |
| `1h` | Latest 1 day ending yesterday |
| `4h` | Latest 1 day ending yesterday |
| `1d` | Latest 1 day ending yesterday |
| `7d` | Latest 7 days ending yesterday |
| `30d` | Latest 30 days ending yesterday |
| `90d` | Latest 90 days ending yesterday |
| `180d` | Latest 180 days ending yesterday |
| `1y` | Latest 365 days ending yesterday |
| `5y` | Latest 1825 days ending yesterday |
| `all` | All available data |

Example:

```bash
bun src/cli.ts get --source baidu --words "微信指数" --range 90d
```

Use explicit dates:

```bash
bun src/cli.ts get --source baidu --words "微信指数" --start-date 2026-04-23 --end-date 2026-05-22
```

When explicit dates are provided, `query.range` in JSON output is `custom`.

### Baidu Area

`--area` is passed to the Baidu Index API. The default is `0`, which represents
the national/all-region view in the current implementation.

```bash
bun src/cli.ts get --source baidu --words "微信指数" --area 0
```

## Output

The CLI has two stdout modes:

- `--format table` prints the human-readable terminal summary. This is the
  default.
- `--format json` prints the full collection result as JSON to stdout. This is
  useful for scripts, pipes, and other programs.

See the full JSON contract in [`json-output.md`](json-output.md).
The machine-readable schema is available at
[`../schemas/unified-output.schema.json`](../schemas/unified-output.schema.json).

When `--format json` is used, stdout and `--out` both use the unified JSON
schema below. When `--format table` is used, stdout is a human-readable table
and `--out` keeps the internal detailed JSON structure used by the table view.

```bash
bun src/cli.ts get --source all --words "gemini" --format json > result.json
```

The unified JSON output is designed to be script-friendly.
See `examples/google-output.json` and `examples/baidu-output.json` for complete
single-source examples.

When `--source all` is used with `--format json`, the top-level object has
`source: "all"` and `results` contains one unified output per source.

```json
{
  "schemaVersion": 1,
  "source": "all",
  "status": "ok",
  "capturedAt": "2026-05-23T00:00:00.000Z",
  "query": {
    "keywords": ["gemini"],
    "range": "30d",
    "startDate": null,
    "endDate": null
  },
  "results": [
    { "source": "baidu", "results": [] },
    { "source": "google", "results": [] }
  ],
  "messages": []
}
```

### Common Fields

```json
{
  "schemaVersion": 1,
  "source": "google",
  "status": "ok",
  "capturedAt": "2026-05-23T00:00:00.000Z",
  "query": {
    "keywords": ["gemini"],
    "range": "30d",
    "startDate": null,
    "endDate": null,
    "region": "US"
  },
  "results": [],
  "messages": [],
  "sourceMeta": {
    "sourceUrl": "https://trends.google.com/trends/explore?...",
    "apiUrls": {
      "main": "https://trends.google.com/trends/api/widgetdata/multiline?..."
    }
  }
}
```

| Field | Description |
| --- | --- |
| `schemaVersion` | Unified output schema version. |
| `source` | `baidu`, `google`, or `all`. |
| `status` | `ok`, `partial`, `no_data`, or `error`. |
| `capturedAt` | ISO timestamp for the collection. |
| `query` | Normalized query parameters. |
| `results` | One result per keyword. |
| `messages` | Human-readable warnings or notes. |
| `sourceMeta` | Best-effort source URL and API URL metadata for debugging. |
| `raw` | Raw response when `--raw true` is used. |

### Google Output

Google output includes timeline data and related queries:

```json
{
  "schemaVersion": 1,
  "source": "google",
  "status": "ok",
  "query": {
    "keywords": ["gemini"],
    "range": "30d",
    "startDate": null,
    "endDate": null,
    "region": "US"
  },
  "results": [
    {
      "keyword": "gemini",
      "status": "ok",
      "search": {
        "unit": "relative",
        "average": 62,
        "mobileAverage": null,
        "points": [
          { "date": "2026-05-22", "value": 94, "pc": null, "mobile": null }
        ],
        "yearOverYear": null,
        "monthOverMonth": null
      },
      "feed": null,
      "relatedQueries": {
        "rising": [
          { "query": "gemini cli", "value": 5000, "label": "Breakout" }
        ],
        "top": [
          { "query": "gemini google", "value": 100, "label": "100" }
        ]
      },
      "message": null
    }
  ],
  "messages": []
}
```

### Baidu Output

Baidu output uses `search` for search index data and `feed` for feed/news index
data. Unindexed keywords are returned with `status: "unavailable"`.

```json
{
  "schemaVersion": 1,
  "source": "baidu",
  "status": "partial",
  "query": {
    "keywords": ["微信指数", "百度指数abc"],
    "range": "30d",
    "startDate": "2026-04-23",
    "endDate": "2026-05-22",
    "region": "0"
  },
  "results": [
    {
      "keyword": "微信指数",
      "status": "ok",
      "search": {
        "unit": "index",
        "average": 187,
        "mobileAverage": 68,
        "points": [
          { "date": "2026-05-22", "value": 180, "pc": 112, "mobile": 68 }
        ],
        "yearOverYear": { "percent": -25, "direction": "down" },
        "monthOverMonth": { "percent": -8, "direction": "down" }
      },
      "feed": {
        "unit": "index",
        "average": 43,
        "mobileAverage": null,
        "points": [
          { "date": "2026-05-22", "value": 41, "pc": null, "mobile": null }
        ],
        "yearOverYear": null,
        "monthOverMonth": null
      },
      "relatedQueries": null,
      "message": null
    },
    {
      "keyword": "百度指数abc",
      "status": "unavailable",
      "search": {
        "unit": "index",
        "average": 0,
        "mobileAverage": 0,
        "points": [],
        "yearOverYear": null,
        "monthOverMonth": null
      },
      "feed": {
        "unit": "index",
        "average": 0,
        "mobileAverage": 0,
        "points": [],
        "yearOverYear": null,
        "monthOverMonth": null
      },
      "relatedQueries": null,
      "message": "关键词未被百度指数收录"
    }
  ],
  "messages": ["1 个关键词不可用或未收录"]
}
```

## Raw Responses

Raw third-party responses are omitted by default. Enable them only for local
debugging:

```bash
bun src/cli.ts get --source google --words "gemini" --raw true
```

Review raw output before sharing it. Raw responses may include service-specific
metadata.

## How Data Is Collected

`ohmytrends` uses the browser for authentication and same-origin context, then
uses service APIs for data:

- Google Trends: calls `/trends/api/explore`,
  `/trends/api/widgetdata/multiline`, and
  `/trends/api/widgetdata/relatedsearches` from the authenticated page context.
- Baidu Index: opens the trend page, observes or requests search/feed index API
  responses, then decrypts encoded index payloads inside the page context.

No screenshots or OCR are used for trend data.
