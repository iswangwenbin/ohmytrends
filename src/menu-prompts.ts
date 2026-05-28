import { cancel, groupMultiselect, intro, isCancel, log, note, outro, select, spinner, text } from "@clack/prompts";
import { styleText } from "node:util";
import { rm } from "node:fs/promises";
import type { Key } from "node:readline";
import { hasBaiduLoginInProfile, verifyBaiduLogin } from "./baidu.js";
import { renderBanner } from "./banner.js";
import { closeKeptOpenContexts } from "./browser-utils.js";
import { DEFAULT_BAIDU_PROFILE_DIR, DEFAULT_GOOGLE_PROFILE_DIR } from "./config.js";
import { hasGoogleLoginInProfile, verifyGoogleLogin } from "./google.js";
import { readLanguage } from "./i18n.js";
import { runtimeInfo } from "./logger.js";
import { runLoginPrompts } from "./login-prompts.js";
import { logoutProfiles } from "./logout.js";
import { readOptions } from "./options.js";
import { printOutputJson, printOutputSummary, writeJsonOutput, writeOutput } from "./output.js";
import { collectAllSources, collectFailures, collectSource, optionsForSource } from "./runner.js";
import { startServer } from "./server.js";
import { importableSources, importBrowserSession, scanBrowserProfiles } from "./session-import.js";
import { toUnifiedMultiSourceOutput, toUnifiedOutput } from "./unified-output.js";
import type { Options, OutputFormat, Source, SourceOption, TerminalLanguage } from "./types.js";

type MenuAction = "login" | "login-google" | "login-baidu" | "skip-login" | "import" | "get" | "serve" | "switch-login" | "quit";
export type SwitchLoginTarget = Source | "all";

type MenuItem = {
  label: string;
  value: MenuAction;
  description: string;
  hint: string;
};

export type LoginGate = {
  baidu: boolean;
  google: boolean;
  ready: boolean;
};

function readyFromSources(baidu: boolean, google: boolean): boolean {
  return baidu && google;
}

function hasAnyLogin(gate: LoginGate): boolean {
  return gate.baidu || gate.google;
}

export function sourceForGate(gate: LoginGate): SourceOption {
  if (gate.baidu && gate.google) return "all";
  if (gate.baidu) return "baidu";
  if (gate.google) return "google";
  return "all";
}

export async function runMainMenuPrompts(): Promise<void> {
  if (!isInteractivePromptAvailable()) {
    return;
  }

  const lang = readLanguage();
  const copy = menuCopy(lang);
  console.log(`${renderBanner()}\n`);
  intro(" ");

  let loginGate = await detectVerifiedLoginGate();
  note([
    copy.quickStartDescription,
  ].join("\n"), copy.quickStartTitle);

  while (!loginGate.ready) {
    const action = await selectAuthStepAction(loginGate, lang);
    if (!action || action === "quit" || process.exitCode) return;
    if (action === "skip-login" && hasAnyLogin(loginGate)) break;
    await runMenuAction(action, lang);
    if (process.exitCode) return;
    loginGate = await detectVerifiedLoginGate();
  }

  while (true) {
    const action = await selectReadyStepAction(loginGate, lang);
    if (!action || action === "quit" || process.exitCode) return;
    const result = await runMenuAction(action, lang);
    if (result === "refresh") {
      if (process.exitCode) return;
      loginGate = await detectVerifiedLoginGate();
      continue;
    }
    if (result !== "back") return;
  }
}

async function selectAuthStepAction(loginGate: LoginGate, lang: TerminalLanguage): Promise<MenuAction | undefined> {
  const copy = menuCopy(lang);
  const items = authStepItemsFor(loginGate, lang);
  note(authStepMessage(loginGate, lang), copy.authStepMessage);
  const action = await select<MenuAction>({
    message: copy.authStepSelectMessage,
    options: items.map((item) => ({
      label: item.label,
      hint: "",
      value: item.value,
    })),
    initialValue: items[0]?.value,
  });
  if (isCancel(action)) {
    cancel(copy.exited);
    return "quit";
  }
  return action;
}

async function selectReadyStepAction(loginGate: LoginGate, lang: TerminalLanguage): Promise<MenuAction | undefined> {
  const copy = menuCopy(lang);
  note([
    ...loginStatusLines(loginGate, lang),
    "",
    copy.readyNote(sourceForGate(loginGate)),
  ].join("\n"), copy.readyTitle);
  const action = await select<MenuAction>({
    message: copy.readyStepMessage,
    options: readyStepItemsFor(lang).map((item) => ({
      label: item.label,
      hint: item.hint,
      value: item.value,
    })),
    initialValue: "get",
  });
  if (isCancel(action)) {
    cancel(copy.exited);
    return "quit";
  }
  return action;
}

export function menuSubtitle(
  action: MenuAction | undefined,
  gate: LoginGate = detectLoginGate(),
  lang: TerminalLanguage = readLanguage(),
): string {
  const copy = menuCopy(lang);
  return [
    sectionLine(copy.initMode),
    `  ${copy.quickStartTitle}`,
    "",
    sectionLine(copy.quickStartTitle),
    `  ${copy.baiduLogin}: ${gate.baidu ? copy.ready : copy.missing}`,
    `  ${copy.googleLogin}: ${gate.google ? copy.ready : copy.missing}`,
    `  ${copy.nextStep}: ${gate.ready ? copy.nextStepReady : copy.nextStepLogin}`,
  ].join("\n");
}

type MenuActionResult = "done" | "back" | "refresh";
type PromptCancelKey = "escape" | "interrupt" | undefined;

async function runMenuAction(action: MenuAction | undefined, lang: TerminalLanguage = readLanguage()): Promise<MenuActionResult> {
  if (!action || action === "quit") return "done";
  if (action === "login") {
    await runLoginPrompts([]);
    return "done";
  }
  if (action === "login-google") {
    await runLoginPrompts(["--source", "google"]);
    return "done";
  }
  if (action === "login-baidu") {
    await runLoginPrompts(["--source", "baidu"]);
    return "done";
  }
  if (action === "skip-login") {
    return "back";
  }
  if (action === "import") {
    await runImportSessionPrompts();
    return "done";
  }
  if (action === "get") {
    return await runTerminalQueryPrompts(lang, detectLoginGate());
  }
  if (action === "serve") {
    await startServer(["--host", "127.0.0.1", "--port", "3000", "--lang", lang]);
  }
  if (action === "switch-login") {
    return await runSwitchLoginPrompts(lang);
  }
  return "done";
}

export function actionMessage(action: MenuAction): string {
  if (action === "login") return "准备进入 login 登录向导...";
  if (action === "login-google") return "准备进入 Google login 登录向导...";
  if (action === "login-baidu") return "准备进入百度 login 登录向导...";
  if (action === "skip-login") return "跳过补全登录，进入下一步...";
  if (action === "import") return "准备扫描本地浏览器会话...";
  if (action === "get") return "get 采集表单后续会加入；当前请使用命令参数。";
  if (action === "serve") return "正在启动 HTTP API 服务...";
  if (action === "switch-login") return "准备切换登录账号...";
  return "退出。";
}

export function descriptionFor(
  action: string | undefined,
  gate?: LoginGate,
  lang: TerminalLanguage = readLanguage(),
): string {
  const sourceItems = gate ? menuItemsFor(gate, lang) : [...readyStepItemsFor(lang), ...authStepItemsFor(undefined, lang)];
  const item = sourceItems.find((entry) => entry.value === action);
  return item ? item.description : menuCopy(lang).chooseAction;
}

export function labelFor(action: MenuAction | undefined, gate?: LoginGate, lang: TerminalLanguage = readLanguage()): string {
  const sourceItems = gate ? menuItemsFor(gate, lang) : [...readyStepItemsFor(lang), ...authStepItemsFor(undefined, lang)];
  return sourceItems.find((item) => item.value === action)?.label || menuCopy(lang).none;
}

export function detailFor(action: MenuAction | undefined, gate: LoginGate, lang: TerminalLanguage = readLanguage()): string {
  const copy = menuCopy(lang);
  const item = menuItemsFor(gate, lang).find((entry) => entry.value === action);
  if (!item) return copy.chooseStep;
  return [
    `${item.label}`,
    "",
    item.description,
    "",
    `${copy.tipPrefix}${item.hint}`,
  ].join("\n");
}

export function helpFor(action: MenuAction | undefined, gate: LoginGate, lang: TerminalLanguage = readLanguage()): string {
  const copy = menuCopy(lang);
  const item = menuItemsFor(gate, lang).find((entry) => entry.value === action);
  if (!item) return `  ${copy.chooseAction}`;
  return [
    sectionLine(`${gate.ready ? copy.runAction : copy.loginPrep}`),
    `  ${item.description}`,
  ].join("\n");
}

function sectionLine(label: string): string {
  return `◇ ${label}`;
}

async function runTerminalQueryPrompts(lang: TerminalLanguage, gate: LoginGate = detectLoginGate()): Promise<MenuActionResult> {
  const range = "30d";
  const geoValue = "";

  while (true) {
    const source = await selectTerminalQuerySource(gate, lang);
    if (source === "exit") return "done";
    if (source === "back") return "back";

    const format = await selectTerminalOutputFormat(lang);
    if (format === "exit") return "done";
    if (format === "back") return "back";

    try {
      while (true) {
        const action = await runTerminalQueryPromptOnce({
          source,
          range,
          geo: geoValue,
          format,
        });
        if (action === "continue") continue;
        if (action === "back") break;
        return "done";
      }
    } finally {
      await closeKeptOpenContexts();
    }
  }
}

async function selectTerminalQuerySource(gate: LoginGate, lang: TerminalLanguage): Promise<SourceOption | "back" | "exit"> {
  const copy = menuCopy(lang);
  const { value: source, cancelKey } = await withPromptCancelKey(() => select<SourceOption>({
    message: copy.selectQuerySource,
    options: querySourceOptionsFor(gate, lang),
    initialValue: sourceForGate(gate),
  }));
  if (isCancel(source)) {
    if (cancelKey === "interrupt") {
      cancel(copy.exited);
      return "exit";
    }
    return "back";
  }
  return source;
}

async function selectTerminalOutputFormat(lang: TerminalLanguage): Promise<OutputFormat | "back" | "exit"> {
  const copy = menuCopy(lang);
  const { value: format, cancelKey } = await withPromptCancelKey(() => select<OutputFormat>({
    message: copy.selectOutputFormat,
    options: [
      { label: copy.table, value: "table", hint: copy.tableHint },
      { label: "JSON", value: "json", hint: copy.jsonHint },
    ],
    initialValue: "table",
  }));
  if (isCancel(format)) {
    if (cancelKey === "interrupt") {
      cancel(copy.exited);
      return "exit";
    }
    return "back";
  }
  return format;
}

async function runSwitchLoginPrompts(lang: TerminalLanguage): Promise<MenuActionResult> {
  const copy = menuCopy(lang);
  const { value: target, cancelKey } = await withPromptCancelKey(() => select<SwitchLoginTarget>({
    message: copy.switchLoginSelectMessage,
    options: switchLoginOptionsFor(lang),
    initialValue: "all",
  }));
  if (isCancel(target)) {
    if (cancelKey === "interrupt") {
      cancel(copy.exited);
      return "done";
    }
    return "back";
  }

  await closeKeptOpenContexts();
  log.info(copy.switchLoginClearing(switchLoginTargetLabel(target, lang)));
  const results = await logoutProfiles(switchLoginLogoutArgsForTarget(target));
  for (const result of results) {
    log.info(copy.switchLoginCleared(sourceLabel(result.source, lang), result.profileDir));
  }
  await runLoginPrompts(switchLoginLoginArgsForTarget(target));
  return "refresh";
}

export function switchLoginOptionsFor(
  lang: TerminalLanguage = readLanguage(),
): Array<{ label: string; value: SwitchLoginTarget; hint: string }> {
  const copy = menuCopy(lang);
  return [
    {
      label: copy.switchLoginAll,
      value: "all",
      hint: copy.switchLoginAllHint,
    },
    {
      label: copy.switchLoginGoogle,
      value: "google",
      hint: copy.switchLoginGoogleHint,
    },
    {
      label: copy.switchLoginBaidu,
      value: "baidu",
      hint: copy.switchLoginBaiduHint,
    },
  ];
}

export function switchLoginLoginArgsForTarget(target: SwitchLoginTarget): string[] {
  return target === "all" ? [] : ["--source", target];
}

export function switchLoginLogoutArgsForTarget(target: SwitchLoginTarget): string[] {
  return [target];
}

function switchLoginTargetLabel(target: SwitchLoginTarget, lang: TerminalLanguage): string {
  if (target === "all") return lang === "zh" ? "全部账号" : "all accounts";
  return sourceLabel(target, lang);
}

type TerminalQueryPromptAction = "continue" | "back" | "exit";

async function runTerminalQueryPromptOnce(defaults: {
  source: SourceOption;
  range: string;
  geo: string;
  format: OutputFormat;
}): Promise<TerminalQueryPromptAction> {
  const lang = readLanguage();
  const copy = menuCopy(lang);
  const { value: wordsValue, cancelKey } = await withPromptCancelKey(() => text({
    message: copy.keywordPrompt,
    placeholder: copy.keywordPlaceholder,
    validate: (value) => {
      if (!value?.trim()) return copy.keywordRequired;
      const command = value.trim().toLowerCase();
      if (command === "/back" || command === "/exit") return undefined;
      const words = splitCsv(value);
      if (words.length === 0) return copy.keywordRequired;
      if (words.length > 5) return copy.keywordLimit;
      return undefined;
    },
  }));
  if (isCancel(wordsValue)) {
    if (cancelKey === "interrupt") {
      cancel(copy.exited);
      return "exit";
    }
    return "back";
  }

  const command = wordsValue.trim().toLowerCase();
  if (command === "/back") return "back";
  if (command === "/exit") {
    outro(copy.continuousQueryExited);
    return "exit";
  }

  await closeKeptOpenContexts();
  await runTerminalQuery(
    buildTerminalQueryArgs({
      words: wordsValue,
      source: defaults.source,
      range: defaults.range,
      geo: defaults.geo,
      format: defaults.format,
      lang,
    }),
    { skipLoginVerify: true },
  );
  return "continue";
}

async function withPromptCancelKey<T>(prompt: () => Promise<T>): Promise<{ value: T; cancelKey: PromptCancelKey }> {
  let cancelKey: PromptCancelKey;
  const onKeypress = (_input: string | undefined, key: Key | undefined) => {
    if (key?.sequence === "\u0003" || (key?.ctrl && key.name === "c")) {
      cancelKey = "interrupt";
      return;
    }
    if (key?.name === "escape" || key?.sequence === "\u001B") {
      cancelKey = "escape";
    }
  };
  process.stdin.on("keypress", onKeypress);
  try {
    const value = await prompt();
    return { value, cancelKey };
  } finally {
    process.stdin.off("keypress", onKeypress);
  }
}

export function buildTerminalQueryArgs(input: {
  words: string;
  source: SourceOption;
  range: string;
  geo?: string;
  format: OutputFormat;
  lang?: TerminalLanguage;
}): string[] {
  const args = [
    "--words",
    input.words,
    "--source",
    input.source,
    "--range",
    input.range,
    "--format",
    input.format,
  ];
  if (input.geo?.trim()) args.push("--geo", input.geo.trim().toUpperCase());
  args.push("--lang", input.lang || readLanguage());
  return args;
}

export function querySourceOptionsFor(
  gate: LoginGate,
  lang: TerminalLanguage = readLanguage(),
): Array<{ label: string; value: SourceOption; hint?: string; disabled?: boolean }> {
  const copy = menuCopy(lang);
  const baiduMissing = !gate.baidu;
  const googleMissing = !gate.google;
  return [
    {
      label: copy.querySourceAll,
      value: "all",
      hint: baiduMissing || googleMissing ? copy.querySourceRequiresBoth : copy.querySourceAllHint,
      disabled: baiduMissing || googleMissing,
    },
    {
      label: copy.querySourceGoogle,
      value: "google",
      hint: googleMissing ? copy.querySourceGoogleMissing : copy.querySourceGoogleHint,
      disabled: googleMissing,
    },
    {
      label: copy.querySourceBaidu,
      value: "baidu",
      hint: baiduMissing ? copy.querySourceBaiduMissing : copy.querySourceBaiduHint,
      disabled: baiduMissing,
    },
  ];
}

async function runTerminalQuery(args: string[], optionsOverride: { skipLoginVerify?: boolean } = {}): Promise<void> {
  const options = readOptions(args);
  const copy = menuCopy(options.lang);
  const spin = spinner({ indicator: "timer" });
  spin.start(optionsOverride.skipLoginVerify ? copy.querying : copy.verifyingLogin);
  try {
    if (!optionsOverride.skipLoginVerify) {
      const login = await verifyQueryLogin(options);
      if (!login.ready) {
        spin.error(`${sourceLabel(login.source, options.lang)} ${copy.loginInvalid}`);
        log.error(`${sourceLabel(login.source, options.lang)} ${copy.loginInvalidDetail}`);
        return;
      }
      spin.message(copy.querying);
    }
    if (options.source === "all") {
      const collection = await collectAllSources(options);
      const { outputs, sourceOptions } = collection;
      const failures = collectFailures(collection);
      spin.stop(failures.length === outputs.length ? copy.queryFailed : copy.queryDone);
      for (const failure of failures) {
        log.warn(options.lang === "zh"
          ? `${sourceLabel(failure.source, options.lang)} 查询失败：${failure.message}`
          : `${sourceLabel(failure.source, options.lang)} query failed: ${failure.message}`);
      }
      if (options.format === "json") {
        const unified = toUnifiedMultiSourceOutput([
          toUnifiedOutput(outputs[0], sourceOptions[0]),
          toUnifiedOutput(outputs[1], sourceOptions[1]),
        ], options);
        writeJsonOutput(unified, options.out);
        printOutputJson(unified);
        return;
      }
      writeJsonOutput({
        schemaVersion: 1,
        source: "all",
        capturedAt: new Date().toISOString(),
        results: outputs,
      }, options.out);
      printOutputSummary(outputs[0], sourceOptions[0]);
      console.log("");
      printOutputSummary(outputs[1], sourceOptions[1]);
      return;
    }

    const output = await collectSource(options.source, options);
    spin.stop(copy.queryDone);
    if (options.format === "json") {
      const unified = toUnifiedOutput(output, options);
      writeJsonOutput(unified, options.out);
      printOutputJson(unified);
      return;
    }
    writeOutput(output, options.out);
    printOutputSummary(output, options);
  } catch (error) {
    spin.error(copy.queryFailed);
    throw error;
  }
}

async function verifyQueryLogin(options: Options): Promise<{ ready: true } | { ready: false; source: Source }> {
  if (options.source === "all" || options.source === "baidu") {
    const baiduOptions = options.source === "all" ? optionsForSource(options, "baidu") : options;
    const baiduReady = await verifyBaiduLogin({
      profileDir: baiduOptions.profileDir,
      timeoutMs: 20_000,
    });
    if (!baiduReady) return { ready: false, source: "baidu" };
  }
  if (options.source === "all" || options.source === "google") {
    const googleOptions = options.source === "all" ? optionsForSource(options, "google") : options;
    const googleReady = await verifyGoogleLogin({
      profileDir: googleOptions.profileDir,
      timeoutMs: 20_000,
      words: googleOptions.words,
      range: googleOptions.range,
      geo: googleOptions.geo,
    });
    if (!googleReady) return { ready: false, source: "google" };
  }
  return { ready: true };
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function runImportSessionPrompts(): Promise<void> {
  runtimeInfo("正在扫描本机浏览器 profile...");
  const candidates = await scanBrowserProfiles();
  if (candidates.length === 0) {
    runtimeInfo("没有发现包含百度或 Google 登录状态的 Chromium 浏览器 profile。\n你可以继续使用：ohmytrends login");
    return;
  }

  const lang = readLanguage();
  const copy = menuCopy(lang);
  const groupedChoices = groupedImportChoices(candidates, lang);

  if (!isInteractivePromptAvailable()) {
    runtimeInfo(lang === "zh" ? "发现可导入的登录状态：" : "Found importable login sessions:");
    for (const choice of groupedChoices) {
      runtimeInfo(`- ${choice.label}`);
    }
    runtimeInfo(lang === "zh"
      ? "本地浏览器会话导入入口当前已隐藏，请使用 ohmytrends login 手动登录。"
      : "Local browser session import is currently hidden. Use ohmytrends login instead.");
    return;
  }

  const selectedImports = await selectImportSessions(candidates, lang);
  if (selectedImports.length === 0) {
    log.warn(lang === "zh" ? "已取消导入。" : "Import cancelled.");
    return;
  }

  for (const { source, candidate } of selectedImports) {
    const result = await importBrowserSession({
      source,
      candidate,
    });
    log.info(lang === "zh" ? `来源 profile：${candidate.profileDir}` : `Source profile: ${candidate.profileDir}`);
    log.info(lang === "zh" ? `目标 profile：${result.targetProfileDir}` : `Target profile: ${result.targetProfileDir}`);
    log.info(lang === "zh"
      ? `复制项：${result.copied.join(", ") || "无"}`
      : `Copied: ${result.copied.join(", ") || "none"}`);
    const verified = await verifyImportedLogin(result.source, result.targetProfileDir);
    if (!verified) {
      await rm(result.targetProfileDir, { recursive: true, force: true });
      log.error(lang === "zh"
        ? `${sourceLabel(result.source, lang)} 导入后未能验证登录状态，已清理导入资料。请改用“登录账号”。`
        : `${sourceLabel(result.source, lang)} could not verify login after import. Imported data was removed; please use Log in.`);
      continue;
    }
    log.success(lang === "zh"
      ? `已导入并验证 ${sourceLabel(result.source, lang)}：${result.browser} / ${result.profileName}`
      : `Imported and verified ${sourceLabel(result.source, lang)}: ${result.browser} / ${result.profileName}`);
  }
  outro(lang === "zh" ? "导入检查完成，正在进入下一步..." : "Import check complete. Moving to the next step...");
}

async function verifyImportedLogin(source: Source, profileDir: string): Promise<boolean> {
  try {
    if (source === "baidu") {
      return await verifyBaiduLogin({
        profileDir,
        timeoutMs: 20_000,
      });
    }
    return await verifyGoogleLogin({
      profileDir,
      timeoutMs: 20_000,
      words: ["gemini"],
      range: "today 1-m",
      geo: "",
    });
  } catch (error) {
    const lang = readLanguage();
    log.warn(lang === "zh"
      ? `${sourceLabel(source, lang)} 导入验证失败：${error instanceof Error ? error.message : String(error)}`
      : `${sourceLabel(source, lang)} import verification failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function sourceLabel(source: Source, lang: TerminalLanguage = readLanguage()): string {
  if (source === "google") return "Google Trends";
  return lang === "zh" ? "百度指数" : "Baidu Index";
}

function sourceBadge(source: Source): string {
  return source === "baidu" ? "[Baidu]" : "[Google]";
}

export function groupedImportChoices(
  candidates: Awaited<ReturnType<typeof scanBrowserProfiles>>,
  lang: TerminalLanguage = readLanguage(),
): { label: string; value: string; disabled?: boolean }[] {
  const grouped = new Map<string, { index: number; sources: Source[] }[]>();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const key = `${candidate.browser} / ${candidate.profileName}`;
    const entries = grouped.get(key) || [];
    entries.push({ index, sources: importableSources(candidate) });
    grouped.set(key, entries);
  }

  const items: { label: string; value: string; disabled?: boolean }[] = [];
  for (const [label, entries] of grouped) {
    const first = candidates[entries[0]?.index || 0];
    items.push({
      label: `${label}`,
      value: `group:${label}`,
      disabled: true,
    });
    if (first) {
      items.push({
        label: `  path: ${first.profileDir}`,
        value: `path:${label}`,
        disabled: true,
      });
    }
    for (const entry of entries) {
      for (const source of entry.sources) {
        items.push({
          label: `  ${sourceBadge(source)} ${sourceLabel(source, lang)}`,
          value: `${entry.index}:${source}`,
        });
      }
    }
  }
  return items;
}

export function importPromptOptions(
  candidates: Awaited<ReturnType<typeof scanBrowserProfiles>>,
  source: Source,
): { label: string; value: number }[] {
  return candidates.flatMap((candidate, index) => {
    if (!importableSources(candidate).includes(source)) return [];
    return [{
      label: `${candidate.browser} / ${candidate.profileName} - ${candidate.profileDir}`,
      value: index,
    }];
  });
}

export function detectLoginGate(): LoginGate {
  const baidu = hasBaiduLoginInProfile(defaultProfileDirFor("baidu"));
  const google = hasGoogleLoginInProfile(defaultProfileDirFor("google"));
  return {
    baidu,
    google,
    ready: readyFromSources(baidu, google),
  };
}

export async function detectVerifiedLoginGate(): Promise<LoginGate> {
  const lang = readLanguage();
  const copy = menuCopy(lang);
  const staticGate = detectLoginGate();
  if (!staticGate.baidu && !staticGate.google) return staticGate;

  const spin = isInteractivePromptAvailable() ? spinner({ indicator: "timer" }) : undefined;
  spin?.start(copy.verifyingLogin);

  const baiduOptions = readOptions(["--source", "baidu"]);
  const googleOptions = readOptions(["--source", "google"]);
  const [baidu, google] = await Promise.all([
    staticGate.baidu
      ? verifyBaiduLogin({ profileDir: baiduOptions.profileDir, timeoutMs: 12_000 }).catch(() => false)
      : false,
    staticGate.google
      ? verifyGoogleLogin({
          profileDir: googleOptions.profileDir,
          timeoutMs: 12_000,
          words: googleOptions.words,
          range: googleOptions.range,
          geo: googleOptions.geo,
        }).catch(() => false)
      : false,
  ]);

  const verifiedGate = { baidu, google, ready: readyFromSources(baidu, google) };
  if (verifiedGate.ready) {
    spin?.stop(copy.loginVerified);
  } else {
    spin?.stop(copy.needLogin);
    if (staticGate.baidu && !baidu) log.warn(copy.profileVerifyFailed("百度指数"));
    if (staticGate.google && !google) log.warn(copy.profileVerifyFailed("Google Trends"));
  }
  return verifiedGate;
}

function defaultProfileDirFor(source: Source): string {
  if (source === "baidu") return readOptions(["--source", "baidu"]).profileDir || DEFAULT_BAIDU_PROFILE_DIR;
  return readOptions(["--source", "google"]).profileDir || DEFAULT_GOOGLE_PROFILE_DIR;
}

export function menuItemsFor(gate: LoginGate, lang: TerminalLanguage = readLanguage()): MenuItem[] {
  return gate.ready ? readyStepItemsFor(lang) : authStepItemsFor(gate, lang);
}

export function gateMessage(gate: LoginGate, lang: TerminalLanguage = readLanguage()): string {
  const copy = menuCopy(lang);
  if (gate.ready) return copy.gateReady;
  const missing = [
    gate.baidu ? "" : "百度",
    gate.google ? "" : "Google",
  ].filter(Boolean).join("、");
  return lang === "zh"
    ? `缺少 ${missing} 登录状态，请先登录。`
    : `Missing ${missing} login state. Please log in first.`;
}

function isInteractivePromptAvailable(): boolean {
  return Boolean(
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !process.env.CI &&
    process.env.OHMYTRENDS_NO_PROMPTS !== "true",
  );
}

export function authStepMessage(gate: LoginGate, lang: TerminalLanguage = readLanguage()): string {
  const copy = menuCopy(lang);
  return [
    ...loginStatusLines(gate, lang),
    copy.authStepHint,
    "",
  ].join("\n");
}

export function loginStatusLines(gate: LoginGate, lang: TerminalLanguage = readLanguage()): string[] {
  return [
    loginStatusLine(sourceLabel("baidu", lang), gate.baidu, lang),
    loginStatusLine("Google Trends", gate.google, lang),
  ];
}

function loginStatusLine(label: string, ready: boolean, lang: TerminalLanguage): string {
  const copy = menuCopy(lang);
  const color = ready ? "green" : "yellow";
  const symbol = ready ? "[x]" : "[!]";
  const status = ready ? copy.loggedIn : copy.notLoggedIn;
  return `${paint(color, symbol)} ${label} ${paint(color, status)}`;
}

function paint(color: "green" | "yellow", text: string): string {
  return styleText(color, text, { validateStream: false });
}

async function selectImportSessions(
  candidates: Awaited<ReturnType<typeof scanBrowserProfiles>>,
  lang: TerminalLanguage = readLanguage(),
): Promise<Array<{ source: Source; candidate: Awaited<ReturnType<typeof scanBrowserProfiles>>[number] }>> {
  const copy = menuCopy(lang);
  note([
    lang === "zh" ? "只会在你确认选择后复制会话相关文件。" : "Session files are copied only after you confirm the selection.",
    lang === "zh"
      ? "可以同时选择百度和 Google；同一个浏览器 profile 下的两个服务可以一次导入。"
      : "You can select Baidu and Google together; both services from one browser profile can be imported at once.",
  ].join("\n"), copy.authStepItemsImportLabel);

  const selectedValues = await groupMultiselect<string>({
    message: lang === "zh" ? "选择要导入的浏览器会话" : "Select browser sessions to import",
    options: groupedImportPromptOptions(candidates, lang),
    required: false,
    selectableGroups: false,
  });
  if (isCancel(selectedValues)) {
    cancel(lang === "zh" ? "已取消导入。" : "Import cancelled.");
    return [];
  }
  return selectedValues.flatMap((value) => {
    const [candidateIndexValue, sourceValue] = value.split(":");
    const candidate = candidates[Number(candidateIndexValue)];
    if (!candidate || !isSource(sourceValue)) return [];
    return [{ source: sourceValue, candidate }];
  });
}

export function groupedImportPromptOptions(
  candidates: Awaited<ReturnType<typeof scanBrowserProfiles>>,
  lang: TerminalLanguage = readLanguage(),
): Record<string, Array<{ label: string; value: string; hint?: string }>> {
  const groups: Record<string, Array<{ label: string; value: string; hint?: string }>> = {};
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const group = `${candidate.browser} / ${candidate.profileName}`;
    groups[group] ||= [];
    for (const source of importableSources(candidate)) {
      groups[group].push({
        label: sourceLabel(source, lang),
        value: `${index}:${source}`,
        hint: candidate.profileDir,
      });
    }
  }
  return groups;
}

function isSource(value: string | undefined): value is Source {
  return value === "baidu" || value === "google";
}

function authStepItemsFor(gate: LoginGate | undefined, lang: TerminalLanguage): MenuItem[] {
  const needsBaidu = gate ? !gate.baidu : true;
  const needsGoogle = gate ? !gate.google : true;
  if (lang === "zh") {
    const items: MenuItem[] = [];
    if (needsBaidu && needsGoogle) {
      items.push({
        label: "登录全部账号",
        value: "login",
        description: "依次完成百度和 Google 登录。",
        hint: "",
      });
    }
    if (needsGoogle) {
      items.push({
        label: "登录 Google 账号",
        value: "login-google",
        description: "只打开 Google Trends 登录向导。",
        hint: "",
      });
    }
    if (needsBaidu) {
      items.push({
        label: "登录百度账号",
        value: "login-baidu",
        description: "只打开百度指数登录向导。",
        hint: "",
      });
    }
    if (gate && hasAnyLogin(gate)) {
      items.push({
        label: "跳过，进入下一步",
        value: "skip-login",
        description: "先使用已登录的数据源继续。",
        hint: "",
      });
    }
    return items;
  }

  const items: MenuItem[] = [];
  if (needsBaidu && needsGoogle) {
    items.push({
      label: "Log in to all accounts",
      value: "login",
      description: "Complete Baidu and Google login in sequence.",
      hint: "",
    });
  }
  if (needsGoogle) {
    items.push({
      label: "Log in to Google",
      value: "login-google",
      description: "Open only the Google Trends login wizard.",
      hint: "",
    });
  }
  if (needsBaidu) {
    items.push({
      label: "Log in to Baidu",
      value: "login-baidu",
      description: "Open only the Baidu Index login wizard.",
      hint: "",
    });
  }
  if (gate && hasAnyLogin(gate)) {
    items.push({
      label: "Skip to next step",
      value: "skip-login",
      description: "Continue with the source that is already logged in.",
      hint: "",
    });
  }
  return items;
}

function readyStepItemsFor(lang: TerminalLanguage): MenuItem[] {
  if (lang === "zh") {
    return [
      {
        label: "通过 CLI 查询数据",
        value: "get",
        description: "使用终端命令查询 Google Trends 和百度指数数据。",
        hint: "终端查看或输出 JSON",
      },
      {
        label: "通过 API 查询数据",
        value: "serve",
        description: "启动 HTTP API 服务。默认监听 127.0.0.1:3000。",
        hint: "本地应用或脚本调用",
      },
      {
        label: "切换登录账号",
        value: "switch-login",
        description: "清理已保存的登录会话，然后重新登录百度或 Google。",
        hint: "更换账号或修复登录",
      },
    ];
  }

  return [
    {
      label: "Query in terminal",
      value: "get",
      description: "Query Google Trends and Baidu Index data from the terminal.",
      hint: "View table or output JSON",
    },
    {
      label: "Query through API",
      value: "serve",
      description: "Start the HTTP API server. It listens on 127.0.0.1:3000 by default.",
      hint: "For local apps or scripts",
    },
    {
      label: "Switch login account",
      value: "switch-login",
      description: "Clear saved login sessions, then log in to Baidu or Google again.",
      hint: "Change account or refresh login",
    },
  ];
}

function menuCopy(lang: TerminalLanguage) {
  if (lang === "zh") {
    return {
      quickStartTitle: "快速开始",
      quickStartDescription: "通过 CLI / API 获取关键词趋势数据",
      recommended: "推荐",
      exited: "已退出 ohmytrends。",
      readyTitle: "准备就绪",
      readyNote: (source: SourceOption) => source === "all"
        ? "登录已完成，现在可以选择运行方式。"
        : `已登录 ${sourceLabel(source, "zh")}，现在可以选择运行方式。`,
      readyStepMessage: "第二步：选择运行方式",
      initMode: "初始化模式",
      baiduLogin: "百度登录",
      googleLogin: "Google 登录",
      ready: "已就绪",
      missing: "缺失",
      nextStep: "下一步",
      nextStepReady: "选择采集数据或启动 HTTP API。",
      nextStepLogin: "请先完成登录。",
      chooseAction: "请选择一个操作。",
      none: "无",
      chooseStep: "请选择一个步骤。",
      tipPrefix: "提示：",
      runAction: "运行操作",
      loginPrep: "登录准备",
      selectQuerySource: "请选择查询方式",
      querySourceAll: "同时查询",
      querySourceGoogle: "仅查询 Google Trends",
      querySourceBaidu: "仅查询百度指数",
      querySourceAllHint: "同时获取两个数据源",
      querySourceGoogleHint: "只使用 Google Trends",
      querySourceBaiduHint: "只使用百度指数",
      querySourceRequiresBoth: "需要百度和 Google 都已登录",
      querySourceGoogleMissing: "Google Trends 未登录",
      querySourceBaiduMissing: "百度指数未登录",
      switchLoginSelectMessage: "请选择要切换的登录账号",
      switchLoginAll: "切换全部账号",
      switchLoginGoogle: "切换 Google Trends 账号",
      switchLoginBaidu: "切换百度指数账号",
      switchLoginAllHint: "重新登录两个账号",
      switchLoginGoogleHint: "重新登录 Google",
      switchLoginBaiduHint: "重新登录百度",
      switchLoginClearing: (target: string) => `正在清理 ${target} 的已保存登录状态...`,
      switchLoginCleared: (source: string, profileDir: string) => `${source} 登录状态已清理：${profileDir}`,
      selectOutputFormat: "请选择输出格式",
      table: "表格",
      tableHint: "适合直接在终端查看",
      jsonHint: "适合复制给程序调用",
      keywordPrompt: "请输入关键词，多个关键词用英文逗号分隔",
      keywordPlaceholder: "例如：gpt,claude,gemini",
      keywordRequired: "请输入至少一个关键词",
      keywordLimit: "Google Trends 最多支持 5 个关键词对比",
      continuousQueryExited: "已退出连续查询。",
      verifyingLogin: "正在验证登录状态",
      querying: "正在查询趋势数据",
      loginInvalid: "登录状态无效",
      loginInvalidDetail: "登录状态无效，请先选择“登录账号”重新登录。",
      queryDone: "查询完成",
      queryFailed: "查询失败",
      loginVerified: "登录状态已验证",
      needLogin: "需要准备登录状态",
      profileVerifyFailed: (source: string) => `${source} profile 中有登录痕迹，但实际页面验证失败，请重新登录。`,
      gateReady: "登录状态已就绪，可以采集数据或启动 API。",
      authStepMessage: "第一步：准备登录状态",
      authStepSelectMessage: "请选择登录方式",
      authStepHint: "请先完成登录。",
      authStepItemsImportLabel: "导入本地浏览器会话",
      loggedIn: "已登录",
      notLoggedIn: "未登录",
    };
  }

  return {
    quickStartTitle: "QuickStart",
    quickStartDescription: "Query data in the terminal and through the API",
    recommended: "recommended",
    exited: "Exited ohmytrends.",
    readyTitle: "Ready",
    readyNote: (source: SourceOption) => source === "all"
      ? "Login is complete. Choose how you want to run ohmytrends."
      : `${sourceLabel(source, "en")} is logged in. Choose how you want to run ohmytrends.`,
    readyStepMessage: "Step 2: Choose run mode",
    initMode: "Onboarding mode",
    baiduLogin: "Baidu login",
    googleLogin: "Google login",
    ready: "ready",
    missing: "missing",
    nextStep: "Next step",
    nextStepReady: "Collect data or start the HTTP API.",
    nextStepLogin: "Complete login first.",
    chooseAction: "Choose an action.",
    none: "None",
    chooseStep: "Choose a step.",
    tipPrefix: "Tip: ",
    runAction: "Run action",
    loginPrep: "Login setup",
    selectQuerySource: "Select query source",
    querySourceAll: "Query both",
    querySourceGoogle: "Only Google Trends",
    querySourceBaidu: "Only Baidu Index",
    querySourceAllHint: "Use both data sources",
    querySourceGoogleHint: "Use Google Trends only",
    querySourceBaiduHint: "Use Baidu Index only",
    querySourceRequiresBoth: "Requires both Baidu and Google login",
    querySourceGoogleMissing: "Google Trends is not logged in",
    querySourceBaiduMissing: "Baidu Index is not logged in",
    switchLoginSelectMessage: "Select the login account to switch",
    switchLoginAll: "Switch all accounts",
    switchLoginGoogle: "Switch Google Trends account",
    switchLoginBaidu: "Switch Baidu Index account",
    switchLoginAllHint: "Log in to both again",
    switchLoginGoogleHint: "Log in to Google again",
    switchLoginBaiduHint: "Log in to Baidu again",
    switchLoginClearing: (target: string) => `Clearing saved login state for ${target}...`,
    switchLoginCleared: (source: string, profileDir: string) => `${source} login state cleared: ${profileDir}`,
    selectOutputFormat: "Select output format",
    table: "Table",
    tableHint: "Best for reading in the terminal",
    jsonHint: "Best for programmatic use",
    keywordPrompt: "Enter keywords, separated by commas",
    keywordPlaceholder: "Example: gpt,claude,gemini",
    keywordRequired: "Enter at least one keyword",
    keywordLimit: "Google Trends supports up to 5 comparison keywords",
    continuousQueryExited: "Exited continuous query.",
    verifyingLogin: "Verifying login state",
    querying: "Querying trend data",
    loginInvalid: "login state is invalid",
    loginInvalidDetail: "login state is invalid. Choose Log in and try again.",
    queryDone: "Query complete",
    queryFailed: "Query failed",
    loginVerified: "Login state verified",
    needLogin: "Login setup required",
    profileVerifyFailed: (source: string) => `${source} profile has login traces, but page verification failed. Please log in again.`,
    gateReady: "Login state is ready. You can collect data or start the API.",
    authStepMessage: "Step 1: Prepare login state",
    authStepSelectMessage: "Choose a login method",
    authStepHint: "Complete login first.",
    authStepItemsImportLabel: "Import local browser session",
    loggedIn: "logged in",
    notLoggedIn: "not logged in",
  };
}
