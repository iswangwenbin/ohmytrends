# ohmytrends

[English](README.md) | 简体中文

`ohmytrends` 是一个只支持 Bun 的命令行工具，用来通过 API / CLI 的方式查询 Google Trends 和百度指数

它会在需要时让你手动登录，然后在已认证的页面上下文中请求并解析趋势数据。本项目不会绕过登录、付费权限或第三方访问控制。

## 功能

- 用一个 Bun CLI 查询 Google Trends 和百度指数。
- 采集百度搜索 / 资讯指数、概览表格，以及 Google 时间线 / related queries。
- 支持多关键词对比、统一时间范围参数和 Google `--geo`。
- 需要登录时，通过引导式手动登录使用已授权账号会话。
- 支持可读表格、统一 JSON 输出，也可以启动本地 JSON API。
- 支持可视浏览器调试模式，并可构建单文件可执行程序。

## 环境要求

- Bun 1.3 或更新版本。本项目只支持 Bun，不支持 npm / Node.js runtime。
- 能访问百度指数或 Google Trends。
- 当服务要求登录时，需要使用你自己有权限的账号会话。

## 安装和运行

1. 安装 Bun 1.3 或更新版本：

```bash
curl -fsSL https://bun.com/install | bash
```

2. 安装依赖：

```bash
bun install
```

开发模式：

```bash
bun run dev
```

3. 启动本地 API 服务：

```bash
bun run start
```

首次运行时，如果百度或 Google 需要账号登录，会自动引导你打开浏览器手动登录。

4. 在另一个终端查询：

```bash
# 提交查询，复制返回的 pollUrl。
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d"

# 轮询到 succeeded 或 failed。
curl "http://127.0.0.1:3000/api/trends/<query-id>"

# 或者在同一个接口上等待结果。
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d&wait=true"
```

也可以直接运行 CLI 查询：

```bash
bun run get -- --words "gemini,claude"
```

输出 JSON：

```bash
bun run get -- --words "gemini,claude" --format json
```

构建本地二进制：

```bash
bun run build
./bin/ohmytrends get --words "gemini,claude"
```

## API

```bash
bun run start
# 提交查询，复制返回的 pollUrl。
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d"

# 轮询到 succeeded 或 failed。
curl "http://127.0.0.1:3000/api/trends/<query-id>"

# 或者在同一个接口上等待结果。
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d&wait=true"
```

`/api/trends` 默认返回排队后的查询 id。继续轮询返回的 `pollUrl`，直到状态为
`succeeded` 或 `failed`。结果会写入 SQLite，服务重启后仍然可以查询。

## 使用

完整的命令行参考（命令、参数、环境变量、登录流程、Google / 百度用法、统一 JSON 输出 schema）请看 [`docs/cli-usage.zh-CN.md`](docs/cli-usage.zh-CN.md)。

## 开发

```bash
# 安装项目依赖。
bun install

# 生成 CSS、运行类型检查和测试。
bun run ci

# 使用开发默认值启动交互式 CLI。
bun run dev

# 以可视浏览器调试模式启动，并在采集后保留窗口。
bun run dev:debug

# 查询一个关键词并输出 JSON。
bun run get -- --words "gemini" --format json

# 构建本地单文件可执行程序。
bun run build

# 运行发布检查和 dry-run 打包。
bun run release:check
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

## Agent Skill

Codex / agent skill 支持会放在配套的 `ohmytrends-skills` 仓库中。本仓库专注于 CLI、HTTP API、二进制、文档和 JSON schema。

## 隐私

浏览器资料目录可能包含 cookies、会话、本地存储和账号数据。不要提交或发布：

- `profiles/`
- `data/`
- `exports/`
- `bin/`
- 日志
- `.env` 文件
- 自定义浏览器资料目录

默认 `.gitignore` 已排除常见本地资料目录、构建产物和输出路径。

## 免责声明

本项目通过你自己的浏览器会话自动访问数据。请只在你有权访问的账号和数据范围内使用。第三方网站可能随时变更 HTML、API、登录流程、速率限制或服务条款。本项目不会绕过访问控制，也不保证任何第三方服务的可用性。

`ohmytrends` 是一个独立开源 CLI 项目，与百度、Google 或任何相似名称的网站均无关联。
