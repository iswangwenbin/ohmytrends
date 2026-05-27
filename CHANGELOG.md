# Changelog

## Unreleased

- Add `--google-mode page|api` mirroring `--baidu-mode`. Default is **`page`**:
  the collector opens the explore UI and intercepts the responses Google's own
  UI makes, which is far less likely to be silently rate-limited than direct
  API calls. If page mode returns no data or fails, it automatically falls back
  to `api` mode on the same authenticated page.
- API mode now retries once after a 2.5s delay when Google returns HTTP 200
  with all `hasData=false` (a common headless soft-throttle signature).
- Fix `googleExplorePageUrl` to emit a single comma-joined `q=` value instead
  of repeated `q=` parameters. Google Trends silently drops the repeated form,
  which made page mode load with no keyword and forced a fallback every time.
- Speed up Google page mode by ~40% (5.3s → ~3.2s):
  - Skip the redundant login-check navigation when page mode would re-navigate
    to the explore URL anyway.
  - Wait for the specific `multiline` response instead of `networkidle`
    (Google fires periodic analytics that keep the page non-idle indefinitely).
  - Poll for relatedsearches and exit as soon as one response per keyword
    arrives, instead of a fixed buffer.
- Add `OHMYTRENDS_GOOGLE_TIMING=true` to print per-stage timings for diagnosing
  slow Google collections.
- Fix Baidu login detection: the login state check now requires the page to
  be on `index.baidu.com` with substantial body content, no modal-specific
  login phrases (`扫码登录` / `立即登录` / ...), and no bare `登录` / `注册`
  CTA. Previous releases only rejected pages with the modal-specific phrases
  and misread the logged-out home (which shows just a bare `登录` button) as
  success; an interim attempt required positive markers like `退出登录` but
  failed in the opposite direction because the logout link lives in a hidden
  dropdown that `innerText` doesn't expose. A defense-in-depth re-verification
  runs after navigating back to the index home and throws a clear error if
  login is still not detected.
- Wait for the Baidu Index SPA to hydrate (up to 4s, content ≥80 chars) before
  reading login state. Without this the post-`domcontentloaded` `innerText` is
  a skeleton that fails verification even when the user is actually signed in,
  which caused the login menu to loop with `profile 中有登录痕迹，但实际页面
  验证失败`. The hydration wait polls `body.innerText` directly instead of
  blocking on `networkidle` (Baidu's analytics traffic kept it busy for the
  full 10s timeout), cutting `verifyBaiduLogin` from ~7s to ~1.6s.
- Speed up Baidu page mode by ~60% (~8-10s → ~4s) by adopting the Google
  page-mode pattern: arm response waiters, install route guards, then
  `page.goto(options.url)` straight to the trend URL — skipping the
  `submitHomeSearch` type-and-click ceremony (was ~2-3s of keyboard input
  with 80ms-per-char delay) and the `waitForIndexPage` innerText polling
  (was ~2-3s waiting for DOM markers). The captured API responses are now
  the readiness signal. The "未被收录" DOM detection is also skipped when
  the API responses already cover every requested keyword, eliminating a
  flaky cold-visit false positive where a transient hint banner was misread
  as a real unavailable signal.
- Add `OHMYTRENDS_GOOGLE_MODE` environment variable and `googleMode` HTTP API
  field.
- Split detailed CLI documentation into `docs/cli-usage.md` and
  `docs/cli-usage.zh-CN.md` to keep the README focused on install + quick start.
- Add `bun run start` shortcut for `bun src/cli.ts serve`.
- Reposition the in-browser status overlay to top-center and shrink it ~35% so
  it stays visible when the viewport extends below the screen.

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
