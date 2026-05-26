# ohmytrends

English | [简体中文](README.zh-CN.md)

`ohmytrends` is a Bun-only API / CLI for querying Google Trends and Baidu Index

It opens a persistent `cloakbrowser` Chromium profile, lets you log in manually
when needed, then uses the authenticated page context to request and parse trend
data. The project does not bypass login, paid permissions, or third-party access
controls.

## Features

- Baidu Index search index collection.
- Baidu Index feed/news index collection.
- Baidu overview table parsing.
- Baidu multi-keyword search with comma-separated words.
- Baidu unindexed keyword handling: unavailable words are reported, removed from
  live queries, and returned with default `0` values.
- Google Trends multi-keyword timeline collection, up to 5 comparison keywords.
- Google Trends related queries collection, separated into `top` and `rising`.
- Unified `--range` values with Google `--geo` support.
- Persistent browser profiles through `cloakbrowser`.
- Clack-powered manual login flow for Baidu and Google.
- Headless by default, with automatic visible-browser fallback when login is
  missing.
- Non-headless status overlay in the bottom-right corner with Chinese progress
  messages.
- English and Chinese terminal UI through `--lang en|zh`.
- `--keep-open true` for debugging a visible browser after collection.
- Human-readable table output and unified JSON output.
- Optional Bun + Elysia HTTP API server for JSON queries.
- Optional raw third-party response output with `--raw true`.
- Bun single-file executable build through `bun run build`.
- Bare `ohmytrends` command opens an interactive Clack menu.

## Requirements

- Bun 1.3 or newer. This project is Bun-only and is not tested with Node.js.
- Network access to Baidu Index or Google Trends.
- Your own authorized account session when a service requires login.
- A local Chromium runtime managed by `cloakbrowser`.

## Install

```bash
bun install
bun run ci
```

## Build A Binary

Build a local executable:

```bash
bun run build
./bin/ohmytrends help
```

The build script uses Bun's single-file executable mode:

```bash
bun build ./src/cli.ts --compile --minify --external chromium-bidi --outfile ./bin/ohmytrends
```

`--minify` provides lightweight code minification. The `--external
chromium-bidi` flag avoids a compile-time deep-import resolution issue in
Playwright's optional BiDi bundle.

The executable includes the Bun runtime and project code. It does not include
your browser profile, cookies, login state, output files, or Chromium cache.

### Using The Built Binary

After `bun run build`, use `./bin/ohmytrends` the same way you use
`bun src/cli.ts` during development:

```bash
./bin/ohmytrends help
./bin/ohmytrends login
./bin/ohmytrends logout google
./bin/ohmytrends get --words "gemini,claude" --format json
```

First-time use still requires manual login. Run the binary login command once,
complete login in the visible browser, and the authenticated session will be
stored in the persistent profile directories:

```bash
./bin/ohmytrends login
```

By default, `--source all` stores sessions under:

- `profiles/baidu`
- `profiles/google`

The binary writes output paths relative to the directory where you run it. For
example, this writes `exports/ohmytrends.json` under the current working
directory:

```bash
./bin/ohmytrends get --words "gemini" --format json
```

You can also place the built binary on your `PATH`:

```bash
mkdir -p ~/.local/bin
cp ./bin/ohmytrends ~/.local/bin/ohmytrends
ohmytrends help
```

For debugging a visible browser session:

```bash
./bin/ohmytrends get --source google --words "gemini" --headless false --keep-open true
```

## Quick Start

Log in once:

```bash
bun src/cli.ts login --source google
bun src/cli.ts login --source baidu
```

Collect Google Trends:

```bash
bun src/cli.ts get --source google --words "gemini" --geo US --range 1y
```

Collect Baidu Index:

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --range 30d
```

Collect both sources:

```bash
bun src/cli.ts get --source all --words "gemini,claude" --range 30d --format json
```

`--source all` and `--range 30d` are the defaults, so this is equivalent:

```bash
bun src/cli.ts get --words "gemini,claude" --format json
```

Use the built binary:

```bash
./bin/ohmytrends get --source google --words "gemini" --geo US --range 1y
./bin/ohmytrends get --source baidu --words "微信指数,google" --range 30d
```

The CLI writes JSON to `--out` and prints a terminal summary table.

For machine-readable stdout, use:

```bash
bun src/cli.ts get --source all --words "gemini" --format json
```

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

The interactive flow is split into two steps. Step 1 only prepares login state:
sign in with a visible browser or import a local browser session. Local browser
profiles are scanned only after you choose the import action; the project does
not scan or copy browser data on startup.

Browser-session import is best effort. Chromium-based browsers may encrypt
cookies with browser-specific Keychain or profile policies, so an imported
profile is always verified in the target `ohmytrends` profile before it is
accepted. If verification fails, use the manual `login` flow once.

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
| `--baidu-mode page|api` | Baidu | `page` | Baidu collection mode. `page` simulates page input/clicks and captures normal page responses; `api` tries the faster direct API path first and falls back to page collection. |
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
[`docs/json-output.md`](docs/json-output.md) for the response contract.

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

Baidu defaults to `--baidu-mode page`. Page mode behaves like a manual user: it
opens Baidu Index, types the keywords, clicks search, and captures the responses
produced by the page. This is slower than direct API access but is usually less
likely to trigger Baidu's abnormal-access warning.

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --baidu-mode page
```

Use `api` only when you explicitly want the faster direct API path:

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

See the full JSON contract in [`docs/json-output.md`](docs/json-output.md).
The machine-readable schema is available at
[`schemas/unified-output.schema.json`](schemas/unified-output.schema.json).

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

## Development

```bash
bun install
bun run ci
bun run get -- --words "gemini" --format json
bun run build
bun run release:check
```

The CI workflow runs type checking and Bun tests on pull requests.

Project structure:

- `src/cli.ts` command entrypoint and orchestration.
- `src/options.ts` CLI argument parsing.
- `src/output.ts` JSON writing and terminal tables.
- `src/baidu.ts` Baidu Index login, page search, overview parsing, and trend decoding.
- `src/google.ts` Google login, timeline collection, and related queries.
- `src/browser-utils.ts` shared browser/profile helpers and status overlay.
- `src/overview.ts` shared overview row parsing.
- `src/types.ts` shared data types.
- `src/config.ts` defaults and URL builders.

## Agent Skill

Codex / agent skill support lives in the companion
`ohmytrends-skills` repository. Keep this repository focused on the CLI, HTTP
API, binaries, docs, and JSON schema.

## Privacy

Browser profiles can contain cookies, sessions, local storage, and account data.
Never commit or publish:

- `profiles/`
- `data/`
- `exports/`
- `bin/`
- logs
- `.env` files
- custom browser profile directories

The default `.gitignore` excludes common local profile, build, and output paths.

## Disclaimer

This project automates access through your own browser session. Use it only with
accounts and data you are authorized to access. Third-party sites may change
their HTML, APIs, login flow, rate limits, or terms at any time. This project
does not bypass access controls and does not guarantee availability of any
third-party service.

`ohmytrends` is an independent open-source CLI project and is not affiliated
with Baidu, Google, or any similarly named website.
