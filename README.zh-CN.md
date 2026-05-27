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
- 百度和 Google 都支持双采集模式：`--baidu-mode page|api`、`--google-mode page|api`。
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

- Bun 1.3 或更新版本。本项目只支持 Bun，不支持 npm / Node.js runtime。
- 能访问百度指数或 Google Trends。
- 当服务要求登录时，需要使用你自己有权限的账号会话。
- 本地 Chromium 运行环境由 `cloakbrowser` 管理。

## 安装和运行

1. 安装 Bun：

```bash
curl -fsSL https://bun.com/install | bash
```

2. 安装依赖：

```bash
bun install
```

3. 启动 ohmytrends：

```bash
bun src/cli.ts
```

首次运行时，如果百度或 Google 需要账号登录，会自动引导你打开浏览器手动登录。

4. 用 CLI 查询：

```bash
bun src/cli.ts get --words "gemini,claude"
```

启动本地 API 服务：

```bash
bun src/cli.ts serve
```

输出 JSON：

```bash
bun src/cli.ts get --words "gemini,claude" --format json
```

构建本地二进制：

```bash
bun run build
./bin/ohmytrends get --words "gemini,claude"
```

## API

```bash
bun src/cli.ts serve
curl "http://127.0.0.1:3000/api/trends?words=gemini%2Cclaude&source=all&range=30d"
```

## 使用

完整的命令行参考（命令、参数、环境变量、登录流程、Google / 百度用法、统一 JSON 输出 schema）请看 [`docs/cli-usage.zh-CN.md`](docs/cli-usage.zh-CN.md)。

## 开发

```bash
bun install
bun run ci
bun run dev
bun run dev:debug
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
