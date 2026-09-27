// @ts-nocheck
import { loadSettings, persistSettings } from "@/lib/db";

const CACHE_KEY = "aurai_settings";
const THEME_KEY = "aurai_theme";

export const defaultSettings = {
  systemName: "Aurai Forecast",
  companyName: "Aurai Labs",
  forecastHorizon: 12,
  forecastPeriod: "Monthly",
};

let current = { ...defaultSettings };

// Synchronous read for components that render before the fetch resolves.
// The cache is only a first paint; the database is the source of truth.
export function getSettings() {
  return current;
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function applySettings(s: any) {
  current = { ...defaultSettings, ...s };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  return current;
}

// Called once after login; seeds from cache immediately, then from the DB.
export async function initSettings() {
  applySettings(readCache());
  try {
    applySettings(await loadSettings());
  } catch {
    /* offline or unauthenticated — keep the cached values */
  }
  return current;
}

export async function saveSettings(s: any) {
  applySettings(s);
  await persistSettings(current);
  return current;
}

export function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "dark";
  } catch {
    return "dark";
  }
}

export function setTheme(t: string) {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
  document.documentElement.classList.toggle("dark", t === "dark");
}
