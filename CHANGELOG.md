# Changelog

## 0.1.0

- Initial `ohmytrends` CLI release.
- Add the `get` command with `--source baidu|google|all`; `all` is the default.
- Add unified `--range 1h|4h|1d|7d|30d|90d|180d|1y|5y|all`; `30d` is the default.
- Collect Baidu search index and feed/news index data with comma-separated keywords.
- Handle Baidu unindexed keywords by reporting them, removing them from live queries, and returning default `0` values.
- Collect Google Trends timeline data for up to 5 comparison keywords.
- Collect Google Trends related queries and split them into `top` and `rising`.
- Add `--format table|json`; JSON mode emits a unified schema with `query.range`.
- Add persistent `cloakbrowser` profiles, manual login polling, and visible-browser login fallback.
- Add a non-headless status overlay with Chinese progress messages.
- Add `--keep-open true` for debugging visible browser sessions after collection.
- Add Bun single-file executable build through `bun run build`.
- Add open-source docs, security notes, examples, and CI checks.
- Add dedicated JSON output documentation and a machine-readable JSON Schema.
