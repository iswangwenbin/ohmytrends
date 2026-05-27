# ohmytrends

English | [简体中文](README.zh-CN.md)

`ohmytrends` is a Bun-only API / CLI for querying Google Trends and Baidu Index

It lets you log in manually when needed, then uses the authenticated page
context to request and parse trend data. The project does not bypass login,
paid permissions, or third-party access controls.

## Features

- Baidu Index search index collection.
- Baidu Index feed/news index collection.
- Baidu overview table parsing.
- Baidu multi-keyword search with comma-separated words.
- Baidu unindexed keyword handling: unavailable words are reported, removed from
  live queries, and returned with default `0` values.
- Google Trends multi-keyword timeline collection, up to 5 comparison keywords.
- Google Trends related queries collection, separated into `top` and `rising`.
- Dual collection modes for both sources: `--baidu-mode page|api` and
  `--google-mode page|api`.
- Unified `--range` values with Google `--geo` support.
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

- Bun 1.3 or newer. This project is Bun-only. npm / Node.js runtime is not supported.
- Network access to Baidu Index or Google Trends.
- Your own authorized account session when a service requires login.

## Install And Run

1. Install Bun:

```bash
curl -fsSL https://bun.com/install | bash
```

2. Install dependencies:

```bash
bun install
```

3. Start ohmytrends:

```bash
bun run start
```

The first run will guide you through manual login when Baidu or Google needs an
account session.

4. Query from the CLI:

```bash
bun src/cli.ts get --words "gemini,claude"
```

Start the local API server:

```bash
bun run start
```

Print JSON:

```bash
bun src/cli.ts get --words "gemini,claude" --format json
```

Build a local binary:

```bash
bun run build
./bin/ohmytrends get --words "gemini,claude"
```

## API

```bash
bun run start
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d"
```

## Usage

See [`docs/cli-usage.md`](docs/cli-usage.md) for the full CLI reference: commands, options, environment variables, login flow, Google / Baidu usage details, and the unified JSON output schema.

## Development

```bash
bun install
bun run ci
bun run dev
bun run dev:debug
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
