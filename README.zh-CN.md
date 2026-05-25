# ohmytrends

[English](README.md) | 简体中文

`ohmytrends` 是一个只支持 Bun 的命令行工具，用来通过 API / CLI 的方式查询 Google Trends 和百度指数

它会打开一个持久化的 `cloakbrowser` Chromium 用户资料目录，在需要时让你手动登录，然后在已认证的页面上下文中请求并解析趋势数据。本项目不会绕过登录、付费权限或第三方访问控制。

## 功能

- 采集百度搜索指数。
- 采集百度资讯指数。
- 解析百度指数概览表格。
- 支持百度多个关键词查询，关键词使用英文逗号分隔。
- 处理百度未收录关键词：命令行和状态浮层会提示，实时查询时自动剔除，并在最终结果中返回默认 `0` 值。
- 采集 Google Trends 多关键词时间线，最多支持 5 个关键词对比。
- 采集 Google Trends Related queries，并区分 `top` 和 `rising`。
- 提供统一的 `--range` 参数，并支持 Google `--geo`。
- 使用 `cloakbrowser` 持久化浏览器资料目录。
- 支持基于 Clack 的百度和 Google 手动登录流程。
- 默认 headless 运行，缺少登录状态时自动回退到可视浏览器。
- 非 headless 模式会在页面右下角注入中文采集状态浮层。
- 终端 UI 支持英文和中文，可用 `--lang en|zh` 切换。
- 支持 `--keep-open true`，方便采集后保留浏览器窗口调试。
- 支持人类可读表格输出和统一 JSON 输出。
- 支持基于 Bun + Elysia 的可选 HTTP API 服务。
- 支持 `--raw true` 输出第三方原始响应，主要用于本地调试。
- 支持通过 `bun run build` 构建 Bun 单文件可执行程序。
- 直接运行 `ohmytrends` 会打开交互式 Clack 交互菜单。

## 环境要求

- Bun 1.3 或更新版本。本项目只支持 Bun，不使用 Node.js 测试。
- 能访问百度指数或 Google Trends。
- 当服务要求登录时，需要使用你自己有权限的账号会话。
- 本地 Chromium 运行环境由 `cloakbrowser` 管理。

## 安装

```bash
bun install
bun run ci
```

## 构建二进制

构建本地可执行文件：

```bash
bun run build
./dist/ohmytrends help
```

构建脚本使用 Bun 的单文件可执行模式：

```bash
bun build ./src/cli.ts --compile --minify --external chromium-bidi --outfile ./dist/ohmytrends
```

`--minify` 会做轻量代码压缩。`--external chromium-bidi` 用于避开 Playwright 可选 BiDi bundle 的构建期深层导入解析问题。

生成的可执行文件包含 Bun runtime 和项目代码，但不包含你的浏览器资料目录、cookies、登录状态、输出文件或 Chromium 缓存。

### 使用构建后的二进制

执行 `bun run build` 后，可以像开发时使用 `bun src/cli.ts` 一样使用
`./dist/ohmytrends`：

```bash
./dist/ohmytrends help
./dist/ohmytrends login
./dist/ohmytrends logout google
./dist/ohmytrends get --words "gemini,claude" --format json
```

第一次使用仍然需要手工登录。先运行二进制登录命令，在打开的可视浏览器中完成登录，认证会话会保存到持久化 profile 目录：

```bash
./dist/ohmytrends login
```

默认 `--source all` 会把会话分别保存到：

- `profiles/baidu`
- `profiles/google`

二进制的输出路径相对于你运行命令时所在的当前目录。例如下面的命令会在当前目录下写入 `exports/ohmytrends.json`：

```bash
./dist/ohmytrends get --words "gemini" --format json
```

也可以把构建后的二进制放到 `PATH` 中：

```bash
mkdir -p ~/.local/bin
cp ./dist/ohmytrends ~/.local/bin/ohmytrends
ohmytrends help
```

如果需要调试可视浏览器会话：

```bash
./dist/ohmytrends get --source google --words "gemini" --headless false --keep-open true
```

## 快速开始

先登录一次：

```bash
bun src/cli.ts login --source google
bun src/cli.ts login --source baidu
```

采集 Google Trends：

```bash
bun src/cli.ts get --source google --words "gemini" --geo US --range 1y
```

采集百度指数：

```bash
bun src/cli.ts get --source baidu --words "微信指数,google" --range 30d
```

同时采集两个数据源：

```bash
bun src/cli.ts get --source all --words "gemini,claude" --range 30d --format json
```

`--source all` 和 `--range 30d` 是默认值，所以上面的命令也等价于：

```bash
bun src/cli.ts get --words "gemini,claude" --format json
```

使用构建后的二进制：

```bash
./dist/ohmytrends get --source google --words "gemini" --geo US --range 1y
./dist/ohmytrends get --source baidu --words "微信指数,google" --range 30d
```

CLI 会把 JSON 写入 `--out`，并在终端打印摘要表格。

如果需要机器可读的 stdout：

```bash
bun src/cli.ts get --source all --words "gemini" --format json
```

## 命令

```bash
bun src/cli.ts help
./dist/ohmytrends help
```

不传命令时会打开 Clack 交互菜单：

```bash
bun src/cli.ts
./dist/ohmytrends
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

交互流程分成两步。第一步只处理登录状态：打开浏览器手工登录，或导入本地浏览器会话。只有你主动选择导入操作后，才会扫描本机浏览器 profile；项目不会在启动时自动扫描或复制浏览器数据。

本地浏览器会话导入是尽力而为的能力。Chromium 系浏览器可能会用浏览器专属的 Keychain 或 profile 策略加密 cookies，所以导入后会在 `ohmytrends` 目标 profile 中真实打开页面验证一次；验证失败时会清理导入资料，并建议改用手动 `login` 流程。

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
| `OHMYTRENDS_HOST` | HTTP API 默认 host。 |
| `OHMYTRENDS_PORT` | HTTP API 默认 port。 |
| `BAIDU_INDEX_TIMEOUT_MS` | 默认操作超时时间。 |
| `BAIDU_INDEX_LOGIN_TIMEOUT_MS` | 默认登录轮询超时时间。 |

### `serve`

启动 Bun + Elysia HTTP API 服务：

```bash
bun src/cli.ts serve --host 127.0.0.1 --port 3000
./dist/ohmytrends serve --host 127.0.0.1 --port 3000
```

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
[`docs/json-output.zh-CN.md`](docs/json-output.zh-CN.md)。

首次使用仍可能需要手工登录。服务模式建议先初始化登录会话，再启动 API：

```bash
./dist/ohmytrends login
./dist/ohmytrends serve --port 3000
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

完整 JSON 数据契约请查看 [`docs/json-output.zh-CN.md`](docs/json-output.zh-CN.md)。
机器可读 schema 位于 [`schemas/unified-output.schema.json`](schemas/unified-output.schema.json)。

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

## 开发

```bash
bun install
bun run ci
bun run get -- --words "gemini" --format json
bun run build
bun pm pack --dry-run
```

CI 会在 pull request 上运行类型检查和 Bun 测试。

项目结构：

- `src/cli.ts` 命令入口和编排逻辑。
- `src/options.ts` CLI 参数解析。
- `src/output.ts` JSON 写入和终端表格。
- `src/baidu.ts` 百度指数登录、页面搜索、概览解析和趋势解码。
- `src/google.ts` Google 登录、时间线采集和 related queries。
- `src/browser-utils.ts` 共享浏览器 / 资料目录工具和状态浮层。
- `src/overview.ts` 共享概览行解析。
- `src/types.ts` 共享数据类型。
- `src/config.ts` 默认值和 URL 构造。

## 隐私

浏览器资料目录可能包含 cookies、会话、本地存储和账号数据。不要提交或发布：

- `profiles/`
- `data/`
- `exports/`
- `dist/`
- 日志
- `.env` 文件
- 自定义浏览器资料目录

默认 `.gitignore` 已排除常见本地资料目录、构建产物和输出路径。

## 免责声明

本项目通过你自己的浏览器会话自动访问数据。请只在你有权访问的账号和数据范围内使用。第三方网站可能随时变更 HTML、API、登录流程、速率限制或服务条款。本项目不会绕过访问控制，也不保证任何第三方服务的可用性。

`ohmytrends` 是一个独立开源 CLI 项目，与百度、Google 或任何相似名称的网站均无关联。
