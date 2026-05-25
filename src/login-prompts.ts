import { cancel, intro, log, outro, spinner } from "@clack/prompts";
import { readLanguage } from "./i18n.js";
import { runtimeInfo } from "./logger.js";
import { readFlag, readOptions, withoutFlag } from "./options.js";
import { loginSourceWithOptions } from "./runner.js";
import type { Options, Source, TerminalLanguage } from "./types.js";

export type LoginState = "pending" | "running" | "done" | "error";

export type LoginItem = {
  source: Source;
  options: Options;
  state: LoginState;
  message: string;
};

export type LoginModel = {
  items: LoginItem[];
  activeIndex: number;
  logs: string[];
  finished: boolean;
  failed: boolean;
};

const maxLogs = 10;

export async function runLoginPrompts(args: string[]): Promise<void> {
  const lang = readLanguage(args);
  const copy = loginCopy(lang);
  const model = createLoginModel(args);
  if (isInteractivePromptAvailable()) {
    intro("ohmytrends login");
  }

  await runLoginModel(model, (event) => {
    if (!isInteractivePromptAvailable()) {
      const last = model.logs.at(-1);
      if (last) runtimeInfo(last);
      return;
    }
    if (event?.type === "start") log.step(`${sourceLabel(event.item.source, lang)}: ${copy.openBrowserLogin}`);
    if (event?.type === "done") log.success(`${sourceLabel(event.item.source, lang)}: ${copy.loginReady}`);
    if (event?.type === "error") log.error(`${sourceLabel(event.item.source, lang)}: ${event.item.message}`);
  });

  if (model.failed) {
    if (isInteractivePromptAvailable()) cancel(copy.loginInterrupted);
    process.exitCode = 1;
    return;
  }

  if (isInteractivePromptAvailable()) outro(copy.allReady);
}

export function createLoginModel(args: string[]): LoginModel {
  const lang = readLanguage(args);
  const copy = loginCopy(lang);
  return {
    items: loginOptionsFromArgs(args).map((options) => ({
      source: options.source as Source,
      options: {
        ...options,
        quietStatus: true,
      },
      state: "pending",
      message: copy.pending,
    })),
    activeIndex: -1,
    logs: [],
    finished: false,
    failed: false,
  };
}

type LoginEvent =
  | { type: "start"; item: LoginItem }
  | { type: "status"; item: LoginItem }
  | { type: "done"; item: LoginItem }
  | { type: "error"; item: LoginItem }
  | { type: "finish" };

export async function runLoginModel(model: LoginModel, onChange: (event?: LoginEvent) => void): Promise<void> {
  const lang = model.items[0]?.options.lang || readLanguage();
  const copy = loginCopy(lang);
  addLog(model, copy.startWizard, lang);
  onChange();

  for (let index = 0; index < model.items.length; index += 1) {
    const item = model.items[index];
    model.activeIndex = index;
    item.state = "running";
    item.message = copy.openingBrowser;
    addLog(model, `${sourceLabel(item.source, lang)}: ${copy.openLoginPage}`, lang);
    onChange({ type: "start", item });

    const spin = isInteractivePromptAvailable() ? spinner({ indicator: "timer" }) : undefined;
    spin?.start(`${sourceLabel(item.source, lang)}: ${copy.waitBrowserLogin}`);

    try {
      await loginSourceWithOptions({
        ...item.options,
        onStatus: (message) => {
          item.message = message;
          addLog(model, `${sourceLabel(item.source, lang)}: ${message}`, lang);
          spin?.message(`${sourceLabel(item.source, lang)}: ${message}`);
          onChange({ type: "status", item });
        },
      });
      item.state = "done";
      item.message = copy.loginReady;
      addLog(model, `${sourceLabel(item.source, lang)}: ${copy.loginDone}`, lang);
      spin?.stop(`${sourceLabel(item.source, lang)}: ${copy.loginDone}`);
      onChange({ type: "done", item });
    } catch (error) {
      item.state = "error";
      item.message = error instanceof Error ? error.message : String(error);
      model.failed = true;
      addLog(model, `${sourceLabel(item.source, lang)}: ${item.message}`, lang);
      spin?.error(`${sourceLabel(item.source, lang)}: ${copy.loginFailed}`);
      onChange({ type: "error", item });
      break;
    }
  }

  model.finished = true;
  model.activeIndex = -1;
  addLog(model, model.failed ? copy.loginInterrupted : copy.allReady, lang);
  onChange({ type: "finish" });
}

export function loginOptionsFromArgs(args: string[]): Options[] {
  const explicitSource = readFlag(args, "--source");
  if (explicitSource) {
    const options = readOptions(args);
    if (options.source === "all") return sourceList().map((source) => optionsForLoginSource(args, source));
    return [options as Options & { source: Source }];
  }

  return sourceList().map((source) => optionsForLoginSource(args, source));
}

function sourceList(): Source[] {
  return ["baidu", "google"];
}

function optionsForLoginSource(args: string[], source: Source): Options {
  const customProfileRoot = readFlag(args, "--profile-dir");
  const sharedArgs = customProfileRoot ? withoutFlag(args, "--profile-dir") : args;
  const sourceArgs = [...sharedArgs, "--source", source];
  if (customProfileRoot) sourceArgs.push("--profile-dir", `${customProfileRoot}/${source}`);
  return readOptions(sourceArgs);
}

function addLog(model: LoginModel, message: string, lang: TerminalLanguage = readLanguage()): void {
  const now = new Date().toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour12: false });
  model.logs.push(`${now}  ${message}`);
  if (model.logs.length > maxLogs) model.logs.splice(0, model.logs.length - maxLogs);
}

function sourceLabel(source: Source, lang: TerminalLanguage = readLanguage()): string {
  if (source === "google") return "Google Trends";
  return lang === "zh" ? "百度指数" : "Baidu Index";
}

function isInteractivePromptAvailable(): boolean {
  return Boolean(
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !process.env.CI &&
    process.env.OHMYTRENDS_NO_PROMPTS !== "true",
  );
}

function loginCopy(lang: TerminalLanguage) {
  if (lang === "zh") {
    return {
      pending: "等待登录",
      openBrowserLogin: "打开浏览器登录",
      loginReady: "登录状态已就绪",
      loginInterrupted: "登录流程已中断。",
      allReady: "所有登录状态已就绪。",
      startWizard: "启动登录向导，浏览器会按顺序打开。",
      openingBrowser: "正在打开浏览器...",
      openLoginPage: "正在打开登录页面。",
      waitBrowserLogin: "等待浏览器登录",
      loginDone: "登录完成",
      loginFailed: "登录失败",
    };
  }

  return {
    pending: "Waiting for login",
    openBrowserLogin: "Open browser login",
    loginReady: "Login state is ready",
    loginInterrupted: "Login flow was interrupted.",
    allReady: "All login states are ready.",
    startWizard: "Starting login wizard; browsers will open in sequence.",
    openingBrowser: "Opening browser...",
    openLoginPage: "Opening login page.",
    waitBrowserLogin: "Waiting for browser login",
    loginDone: "Login complete",
    loginFailed: "Login failed",
  };
}
