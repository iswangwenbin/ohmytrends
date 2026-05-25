import type { TerminalLanguage } from "./types.js";

export function readLanguage(args: string[] = process.argv.slice(2)): TerminalLanguage {
  const explicit = readArgValue(args, "--lang") || process.env.OHMYTRENDS_LANG;
  if (explicit) return parseLanguage(explicit, "--lang");

  const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
  if (/^zh([_-]|$)/i.test(locale)) return "zh";
  return "en";
}

export function parseLanguage(value: string, label = "--lang"): TerminalLanguage {
  const normalized = value.trim().toLowerCase();
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh_cn") return "zh";
  if (normalized === "en" || normalized === "en-us" || normalized === "en_us") return "en";
  throw new Error(`Invalid ${label}: ${value}. Expected zh or en`);
}

export function isZh(lang: TerminalLanguage): boolean {
  return lang === "zh";
}

function readArgValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}
