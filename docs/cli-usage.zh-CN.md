# ohmytrends 命令行用法

[English](cli-usage.md) | 简体中文

`ohmytrends` 的命令行参考文档：命令、参数、环境变量、登录流程、Google / 百度的用法细节，以及统一 JSON 输出 schema。安装与快速开始请看项目 [README](../README.zh-CN.md)。

## 常用示例

只查 Google：

```bash
bun src/cli.ts get --source google --words "gemini" --geo US --range 1y
```

只查百度：

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --range 30d
```

构建本地二进制：

```bash
bun run build
./bin/ohmytrends get --words "gemini,claude"
```

生成的可执行文件包含 Bun runtime 和项目代码，但不包含你的浏览器资料目录、cookies、输出文件或 Chromium 缓存。第一次使用仍然需要手工登录：

```bash
./bin/ohmytrends login
```

如果需要调试可视浏览器会话：

```bash
./bin/ohmytrends get --source google --words "gemini" --headless false --keep-open true
```

CLI 会把 JSON 写入 `--out`，并在终端打印摘要表格。

## 命令

```bash
bun src/cli.ts help
./bin/ohmytrends help
```

不传命令时会打开 Clack 交互菜单：

```bash
bun src/cli.ts
./bin/ohmytrends
```

开发时也可以使用：

```bash
bun run dev
```

`bun run dev` 使用默认的 headless 采集模式。需要打开可视浏览器并保留窗口调试时，使用：

```bash
bun run dev:debug
```

在非交互环境中，或设置 `OHMYTRENDS_NO_PROMPTS=true` 时，裸命令会回退到普通 help 输出。

交互流程分成两步。第一步只处理登录状态：打开可视浏览器，让你手工完成登录。

百度和 Google 会话都就绪后，才进入第二步，显示采集和 HTTP API 等运行操作。

### `login`

打开 Clack 登录流程，启动可视浏览器并保存已认证的用户资料：

```bash
bun src/cli.ts login --source google
bun src/cli.ts login --source baidu
bun src/cli.ts login --source all
```

同时登录两个服务：

```bash
bun src/cli.ts login
```

当 `login` 没有传 `--source` 时，`--profile-dir ./profiles` 会被视为根目录，会话会分别保存到：

- `./profiles/baidu`
- `./profiles/google`

`login` 会按顺序处理数据源，因此同一时间只会打开一个手动登录浏览器窗口。在非交互环境中会自动回退到普通日志输出；也可以设置 `OHMYTRENDS_NO_PROMPTS=true` 强制使用普通登录流程。

### `logout`

清理已保存的浏览器登录会话：

```bash
bun src/cli.ts logout
bun src/cli.ts logout google
bun src/cli.ts logout baidu
bun src/cli.ts logout all
```

和 `login` 一样，`logout` 不传目标时会把 `--profile-dir` 当作根目录，并清理其中的 `baidu` 和 `google` 两个子 profile。适合需要强制重新手工登录时使用。

### `get`

从指定数据源采集数据：

```bash
bun src/cli.ts get --source google --words "gemini"
bun src/cli.ts get --source baidu --words "微信指数"
```

使用 `--source all` 可以用同一组关键词和范围同时运行百度和 Google：

```bash
bun src/cli.ts get --source all --words "gemini,claude" --format json
```

主要参数：

| 参数 | 适用数据源 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--source baidu|google|all` | 两者 | `all` | 选择一个数据源，或用 `all` 同时运行两个数据源。 |
| `--words "a,b,c"` | 两者 | `codex,claude` | 英文逗号分隔的关键词。 |
| `--out path.json` | 两者 | 单数据源有各自默认值，`all` 为 `exports/ohmytrends.json` | JSON 输出路径。 |
| `--profile-dir path` | 两者 | 单数据源有各自默认值，`all` 为 `profiles` | 持久化浏览器资料目录。`all` 模式下会作为包含 `baidu` 和 `google` 的根目录。 |
| `--format table|json` | 两者 | `table` | stdout 输出格式。脚本和集成场景建议使用 `json`。 |
| `--headless false` | 两者 | `true` | 始终显示浏览器窗口。 |
| `--keep-open true` | 两者 | `false` | 可视浏览器采集结束后保留窗口，直到按 `Ctrl+C`。 |
| `--login-timeout-ms 300000` | 两者 | `300000` | 手动登录轮询超时时间。 |
| `--timeout-ms 60000` | 两者 | `60000` | 页面和操作超时时间。 |
| `--raw true` | 两者 | `false` | 包含第三方原始 API 响应。只建议本地调试使用。 |
| `--start-date YYYY-MM-DD` | 两者 | 数据源相关 | 自定义范围开始日期。 |
| `--end-date YYYY-MM-DD` | 两者 | 数据源相关 | 自定义范围结束日期。 |
| `--range 1h|4h|1d|7d|30d|90d|180d|1y|5y|all` | 两者 | `30d` | 统一的数据源无关时间范围。 |
| `--area 0` | 百度 | `0` | 百度地区代码。 |
| `--baidu-mode page|api` | 百度 | `page` | 百度采集模式。`page` 直接导航到趋势页并拦截页面发出的搜索/资讯指数 XHR（失败时自动回退 `api`）；`api` 在已认证上下文里直接调内部接口。 |
| `--google-mode page|api` | Google | `page` | Google 采集模式。`page` 打开 explore 页面并拦截 UI 自己发的响应（请求轨迹更像真人，失败或返回空数据时**自动回退 `api`**）；`api` 直接调内部 Trends 接口（更快但 headless 时容易被静默限流）。 |
| `--geo US` | Google | 全球 | Google Trends 地区代码。 |
| `--lang en|zh` | 两者 | 系统 locale | 终端语言。 |

已移除的参数：

| 已移除参数 | 替代写法 |
| --- | --- |
| `--period` | 使用 `--range`。 |
| `--days` | 使用 `--range`。 |
| Google 原生范围，例如 `today 12-m` | 使用 `--range 1y`。 |
| 百度原生范围，例如 `近90天` | 使用 `--range 90d`。 |

环境变量：

| 变量 | 说明 |
| --- | --- |
| `BAIDU_INDEX_PROFILE_DIR` | 百度资料目录。 |
| `GOOGLE_TRENDS_PROFILE_DIR` | Google 资料目录。 |
| `OHMYTRENDS_BAIDU_PROFILE_DIR` | 备用百度资料目录。 |
| `OHMYTRENDS_GOOGLE_PROFILE_DIR` | 备用 Google 资料目录。 |
| `OHMYTRENDS_LANG` | 终端语言，支持 `en` 或 `zh`。 |
| `OHMYTRENDS_HEADLESS` | 默认浏览器显示模式，调试可设为 `false`。 |
| `OHMYTRENDS_KEEP_OPEN` | 默认是否保留可视浏览器窗口，调试可设为 `true`。 |
| `OHMYTRENDS_NO_PROMPTS` | 设为 `true` 可禁用交互式 Clack prompts。 |
| `OHMYTRENDS_BAIDU_MODE` | 默认百度采集模式（`page` 或 `api`）。 |
| `OHMYTRENDS_GOOGLE_MODE` | 默认 Google 采集模式（`page` 或 `api`）。 |
| `OHMYTRENDS_GOOGLE_TIMING` | 设为 `true` 时打印 Google 采集的各阶段耗时，便于排查慢请求。 |
| `OHMYTRENDS_HOST` | HTTP API 默认 host。 |
| `OHMYTRENDS_PORT` | HTTP API 默认 port。 |
| `BAIDU_INDEX_TIMEOUT_MS` | 默认操作超时时间。 |
| `BAIDU_INDEX_LOGIN_TIMEOUT_MS` | 默认登录轮询超时时间。 |

### `serve`

启动 Bun + Elysia HTTP API 服务：

```bash
bun src/cli.ts serve --host 127.0.0.1 --port 3000
./bin/ohmytrends serve --host 127.0.0.1 --port 3000
```

`bun run start` 是 `bun src/cli.ts serve` 的快捷方式（使用默认参数）。

打开 `http://127.0.0.1:3000` 可以查看内置客户端示例页。页面会通过
`fetch()` 请求 `/api/trends`，并渲染返回的统一 JSON。

健康检查：

```bash
curl http://127.0.0.1:3000/health
```

使用 GET 查询：

```bash
curl "http://127.0.0.1:3000/api/trends?source=google&words=gemini&geo=US&range=30d"
```

使用 POST 查询：

```bash
curl -X POST http://127.0.0.1:3000/api/trends \
  -H "content-type: application/json" \
  -d '{"source":"all","words":["gemini","claude"],"range":"30d"}'
```

API 返回和 `get --format json` 相同的统一 JSON 结构。响应数据契约请查看
[`json-output.zh-CN.md`](json-output.zh-CN.md)。

首次使用仍可能需要手工登录。服务模式建议先初始化登录会话，再启动 API：

```bash
./bin/ohmytrends login
./bin/ohmytrends serve --port 3000
```

支持的请求字段与 CLI 参数对应，使用 camelCase：
`source`、`words`、`range`、`startDate`、`endDate`、`geo`、`area`、
`profileDir`、`raw`、`headless`、`keepOpen`、`timeoutMs` 和
`loginTimeoutMs`。API 也支持 `lang`，可传 `en` 或 `zh` 控制运行时提示语言。

## 登录流程

CLI 会打开一个持久化浏览器上下文。默认采集时使用 headless 模式。

如果服务未登录：

1. CLI 会用可视浏览器重新打开任务。
2. 你手动完成登录。
3. CLI 默认最多轮询 5 分钟登录状态。
4. 检测到登录后，任务自动继续。

菜单和采集命令都会通过打开已保存 profile 来验证登录状态，而不是只检查 cookie 文件是否存在。这样可以避免过期或无法跨浏览器迁移的导入会话被误判成已登录。

当浏览器可见时，`ohmytrends` 会在每个页面右下角注入状态浮层。浮层显示中文进度信息，采集完成时从 `运行中` 切换为 `已完成`，遇到错误或需要处理时显示 `需处理`。

保留浏览器窗口用于调试：

```bash
bun src/cli.ts get --source google --words "gemini" --headless false --keep-open true
```

在终端按 `Ctrl+C` 可以关闭保留的浏览器。

## Google Trends 用法

### 基础采集

```bash
bun src/cli.ts get --source google --words "gemini" --out exports/google-trends.json
```

### 多关键词

```bash
bun src/cli.ts get --source google --words "codex app,claude,gemini"
```

Google Trends 最多支持 5 个关键词进行一次对比。时间线数据会以对比方式采集。Related queries 会按关键词分别采集，并返回在 `relatedQueries` 字段下。

### 采集模式

Google 默认使用 `--google-mode page`。Page 模式打开 Trends explore 页面，让
Google UI 自己发请求，我们拦截响应。请求轨迹更像真实用户，被反爬命中的概率
最低。Page 失败或返回空数据时**自动回退到 `api` 模式**（复用同一个已认证页面）。

```bash
bun src/cli.ts get --source google --words "gemini" --google-mode page
```

`api` 模式直接调用 `/trends/api/explore`、`widgetdata/multiline` 和
`widgetdata/relatedsearches` 等内部接口。速度更快、相关查询关键词映射也最准，
但 headless 场景下更容易遇到 HTTP 200 但 `hasData` 全 false 的"静默限流"。
API 模式遇到空响应时会自动等 2.5 秒重试一次。

```bash
bun src/cli.ts get --source google --words "gemini" --google-mode api
```

### Google 日期范围

使用 `--range` 表示数据源无关范围。如果没有提供范围，Google 默认使用 `--range 30d`。

| Range | Google Trends 范围 |
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

示例：

```bash
bun src/cli.ts get --source google --words "gemini" --range 90d
```

也可以使用显式日期：

```bash
bun src/cli.ts get --source google --words "gemini" --start-date 2026-04-23 --end-date 2026-05-22
```

传入显式日期时，JSON 输出中的 `query.range` 为 `custom`。

### Google 地区

`--geo` 会传给 Google Trends。

常用值：

| Geo | 含义 |
| --- | --- |
| 空值 / 省略 | 全球 |
| `US` | 美国 |
| `CN` | 中国 |
| `HK` | 香港 |
| `TW` | 台湾 |
| `JP` | 日本 |
| `KR` | 韩国 |
| `GB` | 英国 |
| `DE` | 德国 |
| `FR` | 法国 |
| `IN` | 印度 |
| `SG` | 新加坡 |
| `US-CA` | 美国加州 |
| `US-NY` | 美国纽约州 |
| `GB-ENG` | 英格兰 |

示例：

```bash
bun src/cli.ts get --source google --words "gemini" --geo US --range 1y
```

Google Trends 的值是 0-100 的相对兴趣分数，不是绝对搜索量。

## 百度指数用法

### 基础采集

```bash
bun src/cli.ts get --source baidu --words "微信指数" --out exports/baidu-index.json
```

### 多关键词

```bash
bun src/cli.ts get --source baidu --words "微信指数,google"
```

### 采集模式

百度默认使用 `--baidu-mode page`。Page 模式直接导航到趋势页 URL，拦截页面
自己发出的搜索/资讯指数 XHR。请求轨迹和真实百度指数用户一致，比手动拼 API
URL 更不容易触发反爬。Page 失败时自动回退 `api`。

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --baidu-mode page
```

`api` 模式不走趋势页，直接在已认证上下文里调搜索/资讯指数接口。理论上更快，
但在冷会话下更容易碰到百度的异常访问提示。

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --baidu-mode api
```

如果百度提示关键词未被收录，CLI 会：

1. 在终端显示警告。
2. 在可视浏览器状态浮层显示警告。
3. 从实时百度查询中移除不可用关键词。
4. 在最终输出中为不可用关键词返回默认 `0` 值。
5. 将这些词加入 `unavailableWords`。

### 百度日期范围

默认情况下，百度采集使用 `--range 30d`，表示截至昨天的最近 30 天。

使用 `--range` 表示数据源无关范围：

| Range | 百度行为 |
| --- | --- |
| `1h` | 截至昨天的最近 1 天 |
| `4h` | 截至昨天的最近 1 天 |
| `1d` | 截至昨天的最近 1 天 |
| `7d` | 截至昨天的最近 7 天 |
| `30d` | 截至昨天的最近 30 天 |
| `90d` | 截至昨天的最近 90 天 |
| `180d` | 截至昨天的最近 180 天 |
| `1y` | 截至昨天的最近 365 天 |
| `5y` | 截至昨天的最近 1825 天 |
| `all` | 全部可用数据 |

示例：

```bash
bun src/cli.ts get --source baidu --words "微信指数" --range 90d
```

使用显式日期：

```bash
bun src/cli.ts get --source baidu --words "微信指数" --start-date 2026-04-23 --end-date 2026-05-22
```

传入显式日期时，JSON 输出中的 `query.range` 为 `custom`。

### 百度地区

`--area` 会传给百度指数 API。默认值为 `0`，当前实现中表示全国 / 全部地区视图。

```bash
bun src/cli.ts get --source baidu --words "微信指数" --area 0
```

## 输出

CLI 有两种 stdout 模式：

- `--format table` 打印适合人阅读的终端摘要表格，这是默认值。
- `--format json` 向 stdout 打印完整采集结果 JSON，适合脚本、管道和其他程序调用。

完整 JSON 数据契约请查看 [`json-output.zh-CN.md`](json-output.zh-CN.md)。
机器可读 schema 位于 [`../schemas/unified-output.schema.json`](../schemas/unified-output.schema.json)。

使用 `--format json` 时，stdout 和 `--out` 都使用下面的统一 JSON schema。使用 `--format table` 时，stdout 是人类可读表格，而 `--out` 保留 table 视图使用的内部详细 JSON 结构。

```bash
bun src/cli.ts get --source all --words "gemini" --format json > result.json
```

统一 JSON 输出面向脚本调用设计。完整单数据源示例可以参考 `examples/google-output.json` 和 `examples/baidu-output.json`。

当使用 `--source all` 且 `--format json` 时，顶层对象的 `source` 为 `"all"`，`results` 中包含每个数据源各自的统一输出。

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

### 通用字段

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

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 统一输出 schema 版本。 |
| `source` | `baidu`、`google` 或 `all`。 |
| `status` | `ok`、`partial`、`no_data` 或 `error`。 |
| `capturedAt` | 采集时间的 ISO 时间戳。 |
| `query` | 标准化后的查询参数。 |
| `results` | 每个关键词一条结果。 |
| `messages` | 面向人阅读的警告或说明。 |
| `sourceMeta` | 尽力提供的源页面 URL 和 API URL 元数据，方便调试。 |
| `raw` | 使用 `--raw true` 时包含原始响应。 |

### Google 输出

Google 输出包含时间线数据和 related queries：

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

### 百度输出

百度输出使用 `search` 表示搜索指数数据，使用 `feed` 表示资讯指数数据。未收录关键词会返回 `status: "unavailable"`。

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

## 原始响应

默认不会输出第三方原始响应。只建议本地调试时开启：

```bash
bun src/cli.ts get --source google --words "gemini" --raw true
```

分享输出前请检查 raw 内容。原始响应可能包含服务侧元数据。

## 数据采集方式

`ohmytrends` 使用浏览器完成认证并获得同源上下文，然后调用服务接口采集数据：

- Google Trends：在已认证页面上下文中调用 `/trends/api/explore`、`/trends/api/widgetdata/multiline` 和 `/trends/api/widgetdata/relatedsearches`。
- 百度指数：打开趋势页，监听或请求搜索 / 资讯指数 API 响应，然后在页面上下文中解密编码后的指数 payload。

趋势数据不使用截图或 OCR。
