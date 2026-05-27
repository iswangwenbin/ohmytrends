import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
  actionMessage,
  authStepMessage,
  buildTerminalQueryArgs,
  descriptionFor,
  detailFor,
  gateMessage,
  groupedImportChoices,
  groupedImportPromptOptions,
  importPromptOptions,
  helpFor,
  labelFor,
  loginStatusLines,
  menuItemsFor,
  menuSubtitle,
} from "../src/menu-prompts.js";

describe("main menu prompt helpers", () => {
  test("renders menu labels and descriptions", () => {
    expect(labelFor("login", { baidu: false, google: false, ready: false }, "zh")).toBe("登录全部账号");
    expect(labelFor("login-google", { baidu: false, google: false, ready: false }, "zh")).toBe("登录 Google 账号");
    expect(labelFor("login-baidu", { baidu: false, google: false, ready: false }, "zh")).toBe("登录百度账号");
    expect(labelFor("get", { baidu: true, google: true, ready: true }, "zh")).toBe("通过 CLI 查询数据");
    expect(descriptionFor("serve", { baidu: true, google: true, ready: true }, "zh")).toContain("127.0.0.1:3000");
    expect(descriptionFor(undefined, undefined, "zh")).toBe("请选择一个操作。");
    expect(labelFor("login", { baidu: false, google: false, ready: false }, "en")).toBe("Log in to all accounts");
    expect(labelFor("login-google", { baidu: false, google: false, ready: false }, "en")).toBe("Log in to Google");
    expect(labelFor("login-baidu", { baidu: false, google: false, ready: false }, "en")).toBe("Log in to Baidu");
    expect(labelFor("get", { baidu: true, google: true, ready: true }, "en")).toBe("Query in terminal");
  });

  test("renders subtitle for selected action", () => {
    expect(menuSubtitle("login", { baidu: false, google: false, ready: false }, "zh")).toContain("◇ 初始化模式");
    expect(menuSubtitle(undefined, { baidu: true, google: true, ready: true }, "zh")).toContain("百度登录: 已就绪");
    expect(menuSubtitle("login", { baidu: false, google: true, ready: false }, "zh")).toContain("百度登录: 缺失");
    expect(menuSubtitle("login", { baidu: false, google: false, ready: false }, "zh")).toContain("请先完成登录");
    expect(menuSubtitle("login", { baidu: false, google: false, ready: false }, "en")).toContain("◇ Onboarding mode");
  });

  test("renders action messages", () => {
    expect(actionMessage("login")).toContain("login");
    expect(actionMessage("import")).toContain("扫描");
  });

  test("builds terminal query args from prompt answers", () => {
    expect(buildTerminalQueryArgs({
      words: "gemini,claude",
      source: "all",
      range: "30d",
      geo: "us",
      format: "json",
      lang: "zh",
    })).toEqual([
      "--words",
      "gemini,claude",
      "--source",
      "all",
      "--range",
      "30d",
      "--format",
      "json",
      "--geo",
      "US",
      "--lang",
      "zh",
    ]);
  });

  test("uses login as the first step before run actions", () => {
    expect(menuItemsFor({ baidu: false, google: false, ready: false }, "zh").map((item) => item.value)).toEqual([
      "login",
      "login-google",
      "login-baidu",
    ]);
    expect(menuItemsFor({ baidu: true, google: false, ready: false }, "zh").map((item) => item.value)).toEqual([
      "login-google",
      "skip-login",
    ]);
    expect(menuItemsFor({ baidu: false, google: true, ready: false }, "zh").map((item) => item.value)).toEqual([
      "login-baidu",
      "skip-login",
    ]);
    expect(menuItemsFor({ baidu: true, google: true, ready: true }, "zh").map((item) => item.value)).toEqual([
      "get",
      "serve",
    ]);
    expect(gateMessage({ baidu: true, google: false, ready: false }, "zh")).toContain("Google");
    expect(authStepMessage({ baidu: true, google: false, ready: false }, "zh")).not.toContain("第一步");
    expect(authStepMessage({ baidu: true, google: false, ready: false }, "zh")).toContain("请先完成登录");
  });

  test("renders login status with stable symbols", () => {
    expect(loginStatusLines({ baidu: true, google: false, ready: false }, "zh").map(stripVTControlCharacters)).toEqual([
      "[x] 百度指数 已登录",
      "[!] Google Trends 未登录",
    ]);
    expect(loginStatusLines({ baidu: true, google: false, ready: false }, "en").map(stripVTControlCharacters)).toEqual([
      "[x] Baidu Index logged in",
      "[!] Google Trends not logged in",
    ]);
    expect(stripVTControlCharacters(authStepMessage({ baidu: false, google: false, ready: false }, "zh"))).toContain("[!] 百度指数 未登录");
    expect(loginStatusLines({ baidu: true, google: false, ready: false }, "zh")[0]).toContain("\u001B[32m");
    expect(loginStatusLines({ baidu: true, google: false, ready: false }, "zh")[1]).toContain("\u001B[33m");
  });

  test("renders installer-style details", () => {
    expect(detailFor("login", { baidu: false, google: false, ready: false }, "zh")).not.toContain("第一次使用");
    expect(detailFor("login-baidu", { baidu: false, google: true, ready: false }, "zh")).not.toContain("重新登录百度指数");
    expect(detailFor("login-google", { baidu: true, google: false, ready: false }, "zh")).toContain("Google Trends");
    expect(detailFor("serve", { baidu: true, google: true, ready: true }, "zh")).toContain("127.0.0.1:3000");
    expect(helpFor("login-baidu", { baidu: false, google: true, ready: false }, "zh")).toContain("◇ 登录准备");
  });

  test("groups import candidates by browser profile", () => {
    const choices = groupedImportChoices([
      {
        browser: "Chrome",
        profileName: "Default",
        profileDir: "/tmp/chrome/Default",
        rootDir: "/tmp/chrome",
        hasBaidu: true,
        hasGoogle: true,
      },
    ], "zh");

    expect(choices.map((choice) => choice.label)).toEqual([
      "Chrome / Default",
      "  path: /tmp/chrome/Default",
      "  [Baidu] 百度指数",
      "  [Google] Google Trends",
    ]);
    expect(choices.filter((choice) => choice.disabled)).toHaveLength(2);
  });

  test("renders import prompt options for one service at a time", () => {
    const candidates = [
      {
        browser: "Chrome",
        profileName: "Default",
        profileDir: "/tmp/chrome/Default",
        rootDir: "/tmp/chrome",
        hasBaidu: true,
        hasGoogle: true,
      },
      {
        browser: "Comet",
        profileName: "Default",
        profileDir: "/tmp/comet/Default",
        rootDir: "/tmp/comet",
        hasBaidu: false,
        hasGoogle: true,
      },
    ];

    expect(importPromptOptions(candidates, "baidu")).toEqual([
      {
        label: "Chrome / Default - /tmp/chrome/Default",
        value: 0,
      },
    ]);
    expect(importPromptOptions(candidates, "google")).toEqual([
      {
        label: "Chrome / Default - /tmp/chrome/Default",
        value: 0,
      },
      {
        label: "Comet / Default - /tmp/comet/Default",
        value: 1,
      },
    ]);
  });

  test("renders grouped Clack import options", () => {
    const grouped = groupedImportPromptOptions([
      {
        browser: "Chrome",
        profileName: "Default",
        profileDir: "/tmp/chrome/Default",
        rootDir: "/tmp/chrome",
        hasBaidu: true,
        hasGoogle: true,
      },
    ], "zh");

    expect(grouped).toEqual({
      "Chrome / Default": [
        {
          label: "百度指数",
          value: "0:baidu",
          hint: "/tmp/chrome/Default",
        },
        {
          label: "Google Trends",
          value: "0:google",
          hint: "/tmp/chrome/Default",
        },
      ],
    });
  });
});
