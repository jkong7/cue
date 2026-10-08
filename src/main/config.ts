import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import type { Store } from "../engine/store.ts";
import type { Effort } from "../engine/types.ts";

export function loadEnvFile(dir: string) {
  const file = join(dir, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export interface Settings {
  anthropicKey: string;
  deepgramKey: string;
  model: string;
  liveEffort: Effort;
  stealth: boolean;
  autoSuggest: boolean;
  insights: boolean;
  coach: boolean;
  screenshotOnAsk: boolean;
  calendarUrl: string;
  myEmails: string;
}

export interface PublicSettings extends Omit<Settings, "anthropicKey" | "deepgramKey" | "calendarUrl"> {
  hasCalendar: boolean;
  hasAnthropic: boolean;
  hasDeepgram: boolean;
  anthropicSource: "settings" | "env" | "none";
  deepgramSource: "settings" | "env" | "none";
}

const secret = (store: Store, key: string): string => {
  const v = store.getSetting(key);
  if (!v) return "";
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, "base64")) : v;
  } catch {
    return "";
  }
};

const flag = (store: Store, key: string, dflt: boolean) => {
  const v = store.getSetting(key);
  return v === null ? dflt : v === "1";
};

export function readSettings(store: Store): Settings {
  return {
    anthropicKey: secret(store, "anthropicKey") || process.env.ANTHROPIC_API_KEY || "",
    deepgramKey: secret(store, "deepgramKey") || process.env.DEEPGRAM_API_KEY || "",
    model: store.getSetting("model") || process.env.CUE_MODEL || "claude-opus-5-5",
    liveEffort: (store.getSetting("liveEffort") || process.env.CUE_LIVE_EFFORT || "low") as Effort,
    stealth: flag(store, "stealth", false),
    autoSuggest: flag(store, "autoSuggest", true),
    insights: flag(store, "insights", true),
    coach: flag(store, "coach", true),
    screenshotOnAsk: flag(store, "screenshotOnAsk", true),
    calendarUrl: secret(store, "calendarUrl") || process.env.CUE_CALENDAR_ICS || "",
    myEmails: store.getSetting("myEmails") || process.env.CUE_MY_EMAILS || "",
  };
}

export function publicSettings(store: Store): PublicSettings {
  const { anthropicKey, deepgramKey, calendarUrl, ...rest } = readSettings(store);
  return {
    ...rest,
    hasCalendar: !!calendarUrl,
    hasAnthropic: !!anthropicKey,
    hasDeepgram: !!deepgramKey,
    anthropicSource: store.getSetting("anthropicKey") ? "settings" : process.env.ANTHROPIC_API_KEY ? "env" : "none",
    deepgramSource: store.getSetting("deepgramKey") ? "settings" : process.env.DEEPGRAM_API_KEY ? "env" : "none",
  };
}

export function writeSettings(store: Store, patch: Partial<Settings>) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === "anthropicKey" || k === "deepgramKey" || k === "calendarUrl") {
      const s = String(v ?? "").trim();
      store.setSetting(k, s ? (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString("base64") : s) : "");
    } else if (typeof v === "boolean") store.setSetting(k, v ? "1" : "0");
    else if (v !== undefined) store.setSetting(k, String(v));
  }
}
