# ohmytrends

English | [简体中文](README.zh-CN.md)

`ohmytrends` is a Bun-only API / CLI for querying Google Trends and Baidu Index

It lets you log in manually when needed, then uses the authenticated page
context to request and parse trend data. The project does not bypass login,
paid permissions, or third-party access controls.

## Features

- Query Google Trends and Baidu Index from one Bun CLI.
- Collect Baidu search/feed indexes, overview rows, and Google timeline/related
  queries.
- Compare multiple keywords with unified range options and Google `--geo`
  support.
- Use authenticated sessions through a guided manual login flow when needed.
- Output readable tables, unified JSON, or serve a local JSON API.
- Debug with visible-browser mode and build a single-file executable.

## Requirements

- Bun 1.3 or newer. This project is Bun-only. npm / Node.js runtime is not supported.
- Network access to Baidu Index or Google Trends.
- Your own authorized account session when a service requires login.

## Install And Run

1. Install Bun 1.3 or newer:

```bash
curl -fsSL https://bun.com/install | bash
```

2. Install dependencies:

```bash
bun install
```

For development mode:

```bash
bun run dev
```

3. Start the local API server:

```bash
bun run start
```

The first run will guide you through manual login when Baidu or Google needs an
account session.

4. Query from another terminal:

```bash
# Submit a query and copy the returned pollUrl.
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d"

# Poll until status is succeeded or failed.
curl "http://127.0.0.1:3000/api/trends/<query-id>"

# Or wait on the same endpoint.
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d&wait=true"
```

Run a CLI query instead:

```bash
bun run get -- --words "gemini,claude"
```

Print JSON:

```bash
bun run get -- --words "gemini,claude" --format json
```

Build a local binary:

```bash
bun run build
./bin/ohmytrends get --words "gemini,claude"
```

## API

```bash
bun run start
# Submit a query and copy the returned pollUrl.
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d"

# Poll until status is succeeded or failed.
curl "http://127.0.0.1:3000/api/trends/<query-id>"

# Or wait on the same endpoint.
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d&wait=true"
```

`/api/trends` returns a queued query id by default. Poll the returned `pollUrl`
until the status is `succeeded` or `failed`. Results are stored in SQLite, so
they remain available after the server restarts.

## Usage

See [`docs/cli-usage.md`](docs/cli-usage.md) for the full CLI reference: commands, options, environment variables, login flow, Google / Baidu usage details, and the unified JSON output schema.

## Development

```bash
# Install project dependencies.
bun install

# Run generated CSS build, type checking, and tests.
bun run ci

# Start the interactive CLI in development defaults.
bun run dev

# Start development mode with a visible browser kept open for debugging.
bun run dev:debug

# Query one keyword and print JSON output.
bun run get -- --words "gemini" --format json

# Build the local single-file executable.
bun run build

# Run release validation and a dry-run package build.
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
