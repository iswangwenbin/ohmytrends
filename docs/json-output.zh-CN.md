# JSON 输出格式

[English](json-output.md)

本文档说明以下命令在机器可读 JSON 模式下输出的数据格式：

```bash
bun src/cli.ts get --format json
./dist/ohmytrends get --format json
```

在 JSON 模式下，stdout 和 `--out` 都使用本文档描述的统一 schema。默认 table 模式下，stdout 是人类可读表格，`--out` 会使用 table 视图所需的内部详细结构。

JSON Schema 位于 [`schemas/unified-output.schema.json`](../schemas/unified-output.schema.json)。

## 顶层结构

单数据源命令返回 `UnifiedOutput`：

```bash
bun src/cli.ts get --source google --words "gemini" --format json
bun src/cli.ts get --source baidu --words "微信指数" --format json
```

多数据源命令返回 `UnifiedMultiSourceOutput`：

```bash
bun src/cli.ts get --source all --words "gemini" --format json
```

`--source all` 是默认值，因此省略 `--source` 也会返回多数据源结构。

## UnifiedOutput

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 输出 schema 版本。只有破坏性 schema 变更才应递增。 |
| `source` | `"baidu" | "google"` | 产生该输出的数据源。 |
| `status` | `"ok" | "partial" | "no_data" | "error"` | 整体采集状态。 |
| `capturedAt` | string | 采集时间的 ISO 8601 时间戳。 |
| `query` | object | 标准化后的查询参数。 |
| `results` | array | 每个请求关键词一条结果。 |
| `messages` | string[] | 面向人阅读的警告或说明。 |
| `sourceMeta` | object | 尽力提供的源页面和 API 元数据。 |
| `raw` | unknown | 仅在使用 `--raw true` 时出现。可能包含第三方 API 响应数据。 |

### `status`

| 状态 | 含义 |
| --- | --- |
| `ok` | 已为请求的数据源采集到数据。个别时间点仍可能是 `null`。 |
| `partial` | 部分关键词或区块不可用，但采集到了其他数据。 |
| `no_data` | 请求完成，但没有找到可用趋势数据。 |
| `error` | 数据源返回错误类结果，或解析失败并以输出形式表达。 |

### `query`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `keywords` | string[] | 请求关键词，保持请求顺序。 |
| `range` | string | 统一范围：`1h`、`4h`、`1d`、`7d`、`30d`、`90d`、`180d`、`1y`、`5y`、`all` 或 `custom`。 |
| `startDate` | string \| null | 显式 / 自定义范围或数据源推导日期范围的 `YYYY-MM-DD`；否则为 `null`。 |
| `endDate` | string \| null | 显式 / 自定义范围或数据源推导日期范围的 `YYYY-MM-DD`；否则为 `null`。 |
| `region` | string \| null | Google `geo`、百度 `area`，未设置时为 `null`。 |

传入显式日期时，`query.range` 为 `custom`。

### `results[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `keyword` | string | 当前结果对应的关键词。 |
| `status` | `"ok" | "no_data" | "unavailable" | "error"` | 关键词级状态。 |
| `search` | metric \| null | 搜索指数 / interest over time。 |
| `feed` | metric \| null | 百度资讯指数。Google 始终为 `null`。 |
| `relatedQueries` | object \| null | Google related queries，分为 `top` 和 `rising`。百度为 `null`。 |
| `message` | string \| null | 当前关键词的警告或说明。 |

### Metric

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `unit` | `"relative" | "index"` | Google 使用 `relative`，百度使用 `index`。 |
| `average` | number \| null | 可用时的整体平均值。 |
| `mobileAverage` | number \| null | 可用时的移动端平均值。 |
| `points` | point[] | 时间序列数据。 |
| `yearOverYear` | change \| null | 可用时的同比变化。 |
| `monthOverMonth` | change \| null | 可用时的环比变化。 |

Google 值是 0-100 的相对兴趣分数。百度值是百度指数返回的指数值。

### Point

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `date` | string | `YYYY-MM-DD` 日期。 |
| `value` | number \| null | 该日期的整体值。 |
| `pc` | number \| null | 可用时的桌面端值。 |
| `mobile` | number \| null | 可用时的移动端值。 |

`null` 表示数据源没有提供该字段的可用值。

### Change

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `percent` | number \| null | 百分比变化。 |
| `direction` | `"up" | "down" | "flat" | null` | 变化方向。 |

### Related Queries

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `top` | relatedQuery[] | Top related queries。 |
| `rising` | relatedQuery[] | Rising related queries。 |

每条 related query 包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string | 查询文本。 |
| `value` | number \| null | 可用时的数值。Google breakout 可能以较大的数值表示。 |
| `label` | string | 源站展示标签，例如 `100`、`+250%` 或 `Breakout`。 |
| `link` | string | 可选源站链接。 |

### `sourceMeta`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sourceUrl` | string | 采集时使用的页面 URL。 |
| `apiUrls` | object | 采集期间使用的 API URL。Google token 会被脱敏。 |

`sourceMeta` 用于调试和追踪。不要把 API URL 结构视为稳定的第三方契约。

## UnifiedMultiSourceOutput

当 `source` 为 `all` 时，顶层输出为：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 输出 schema 版本。 |
| `source` | `"all"` | 表示多数据源输出。 |
| `status` | `"ok" | "partial" | "no_data" | "error"` | 多数据源合并状态。 |
| `capturedAt` | string | 合并输出时间的 ISO 8601 时间戳。 |
| `query` | object | 共享请求查询。 |
| `results` | UnifiedOutput[] | 每个数据源一个统一输出。 |
| `messages` | string[] | 所有数据源输出消息去重后的列表。 |

合并状态规则：

- 任一数据源为 `error`，则为 `error`。
- 任一数据源为 `partial`，或至少一个数据源为 `ok` 且另一个不是 `ok`，则为 `partial`。
- 所有数据源都是 `ok`，则为 `ok`。
- 没有任何数据源有可用数据，则为 `no_data`。

## 示例

完整示例：

- [`examples/google-output.json`](../examples/google-output.json)
- [`examples/baidu-output.json`](../examples/baidu-output.json)

最小多数据源示例：

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

## 稳定性说明

- `schemaVersion: 1` 是 `--format json` 的稳定统一输出契约。
- 小版本可能新增字段。
- 破坏性变更应递增 `schemaVersion`。
- `raw` 不属于稳定契约。
- `sourceMeta.apiUrls` 适合调试，但依赖第三方服务，可能变化。
