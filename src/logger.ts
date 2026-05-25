import { styleText } from "node:util";
import { readLanguage } from "./i18n.js";

type RuntimeLogLevel = "info" | "warn" | "error";

export function runtimeInfo(message: string): void {
  runtimeLog(message, "info");
}

export function runtimeWarn(message: string): void {
  runtimeLog(message, "warn");
}

export function runtimeError(message: string): void {
  runtimeLog(message, "error");
}

function runtimeLog(message: string, level: RuntimeLogLevel): void {
  const text = message.replace(/^\n+/, "").trimEnd();
  if (!text) return;
  const lang = readLanguage();
  const prefix = level === "warn"
    ? (lang === "zh" ? "警告： " : "Warning: ")
    : level === "error"
      ? (lang === "zh" ? "错误： " : "Error: ")
      : "";
  process.stderr.write(`\n${paint(level, `${prefix}${text}`)}\n`);
}

function paint(level: RuntimeLogLevel, text: string): string {
  const color = level === "error" ? "red" : level === "warn" ? "yellow" : "cyan";
  return styleText(color, text, { validateStream: false });
}
