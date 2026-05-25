# JSON Output Format

[简体中文](json-output.zh-CN.md)

This document describes the machine-readable JSON emitted by:

```bash
bun src/cli.ts get --format json
./dist/ohmytrends get --format json
```

In JSON mode, stdout and `--out` use the unified schema documented here. In the
default table mode, stdout is human-readable and `--out` uses an internal
detailed structure intended for the table view.

The JSON Schema is available at [`schemas/unified-output.schema.json`](../schemas/unified-output.schema.json).

## Top-Level Shapes

Single-source commands return `UnifiedOutput`:

```bash
bun src/cli.ts get --source google --words "gemini" --format json
bun src/cli.ts get --source baidu --words "微信指数" --format json
```

Multi-source commands return `UnifiedMultiSourceOutput`:

```bash
bun src/cli.ts get --source all --words "gemini" --format json
```

`--source all` is the default, so omitting `--source` also returns the
multi-source shape.

## UnifiedOutput

| Field | Type | Description |
| --- | --- | --- |
| `schemaVersion` | `1` | Output schema version. Incremented only for breaking schema changes. |
| `source` | `"baidu" | "google"` | Source that produced this output. |
| `status` | `"ok" | "partial" | "no_data" | "error"` | Overall collection status. |
| `capturedAt` | string | ISO 8601 timestamp for the collection. |
| `query` | object | Normalized query parameters. |
| `results` | array | One result per requested keyword. |
| `messages` | string[] | Human-readable warnings or notes. |
| `sourceMeta` | object | Best-effort source page and API metadata. |
| `raw` | unknown | Present only when `--raw true` is used. May contain third-party API response data. |

### `status`

| Status | Meaning |
| --- | --- |
| `ok` | Data was collected for the requested source. Some individual points can still be `null`. |
| `partial` | Some keywords or sections are unavailable, but other data was collected. |
| `no_data` | The request completed but no usable trend data was found. |
| `error` | The source returned an error-like result or parsing failed in a way represented in output. |

### `query`

| Field | Type | Description |
| --- | --- | --- |
| `keywords` | string[] | Requested keywords, in request order. |
| `range` | string | Unified range: `1h`, `4h`, `1d`, `7d`, `30d`, `90d`, `180d`, `1y`, `5y`, `all`, or `custom`. |
| `startDate` | string \| null | `YYYY-MM-DD` for explicit/custom ranges or source-derived date ranges; otherwise `null`. |
| `endDate` | string \| null | `YYYY-MM-DD` for explicit/custom ranges or source-derived date ranges; otherwise `null`. |
| `region` | string \| null | Google `geo`, Baidu `area`, or `null` when not set. |

For explicit dates, `query.range` is `custom`.

### `results[]`

| Field | Type | Description |
| --- | --- | --- |
| `keyword` | string | Keyword for this result. |
| `status` | `"ok" | "no_data" | "unavailable" | "error"` | Keyword-level status. |
| `search` | metric \| null | Search index / interest over time. |
| `feed` | metric \| null | Baidu feed/news index. Always `null` for Google. |
| `relatedQueries` | object \| null | Google related queries, split into `top` and `rising`. `null` for Baidu. |
| `message` | string \| null | Keyword-specific warning or explanation. |

### Metric

| Field | Type | Description |
| --- | --- | --- |
| `unit` | `"relative" | "index"` | Google uses `relative`; Baidu uses `index`. |
| `average` | number \| null | Overall average value when available. |
| `mobileAverage` | number \| null | Mobile average when available. |
| `points` | point[] | Time series data. |
| `yearOverYear` | change \| null | Year-over-year change when available. |
| `monthOverMonth` | change \| null | Month-over-month change when available. |

Google values are relative 0-100 interest scores. Baidu values are index values
returned by Baidu Index.

### Point

| Field | Type | Description |
| --- | --- | --- |
| `date` | string | `YYYY-MM-DD` date. |
| `value` | number \| null | Overall value for the date. |
| `pc` | number \| null | Desktop value when available. |
| `mobile` | number \| null | Mobile value when available. |

`null` means the source did not provide a usable value for that field.

### Change

| Field | Type | Description |
| --- | --- | --- |
| `percent` | number \| null | Percent change. |
| `direction` | `"up" | "down" | "flat" | null` | Change direction. |

### Related Queries

| Field | Type | Description |
| --- | --- | --- |
| `top` | relatedQuery[] | Top related queries. |
| `rising` | relatedQuery[] | Rising related queries. |

Each related query has:

| Field | Type | Description |
| --- | --- | --- |
| `query` | string | Query text. |
| `value` | number \| null | Numeric value when available. Google breakout values can be represented as large numbers. |
| `label` | string | Source display label, such as `100`, `+250%`, or `Breakout`. |
| `link` | string | Optional source link. |

### `sourceMeta`

| Field | Type | Description |
| --- | --- | --- |
| `sourceUrl` | string | Page URL used for the collection. |
| `apiUrls` | object | API URLs used during collection. Google tokens are redacted. |

`sourceMeta` is for debugging and traceability. Do not treat API URL shape as a
stable third-party contract.

## UnifiedMultiSourceOutput

When `source` is `all`, the top-level output is:

| Field | Type | Description |
| --- | --- | --- |
| `schemaVersion` | `1` | Output schema version. |
| `source` | `"all"` | Indicates multi-source output. |
| `status` | `"ok" | "partial" | "no_data" | "error"` | Combined status across sources. |
| `capturedAt` | string | ISO 8601 timestamp for the combined output. |
| `query` | object | Shared request query. |
| `results` | UnifiedOutput[] | One unified output per source. |
| `messages` | string[] | Unique messages merged from all source outputs. |

The combined status is:

- `error` if any source is `error`.
- `partial` if any source is `partial`, or if at least one source is `ok` and another is not.
- `ok` if all sources are `ok`.
- `no_data` if no source has usable data.

## Examples

Complete examples:

- [`examples/google-output.json`](../examples/google-output.json)
- [`examples/baidu-output.json`](../examples/baidu-output.json)

Minimal multi-source example:

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

## Stability Notes

- `schemaVersion: 1` is the stable unified output contract for `--format json`.
- Additive fields may be introduced in minor releases.
- Breaking changes should increment `schemaVersion`.
- `raw` is intentionally not part of the stable contract.
- `sourceMeta.apiUrls` is useful for debugging but depends on third-party services and can change.
