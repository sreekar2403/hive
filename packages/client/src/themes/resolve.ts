import {
  THEME_IDS,
  type ThemeId,
  type ThemeMode,
  type ResolvedMode,
} from "./types";

export const THEME_KEY = "hive.theme";
export const MODE_KEY = "hive.mode";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredState {
  theme: ThemeId;
  mode: ThemeMode;
}

export function sanitizeTheme(v: unknown): ThemeId {
  return (THEME_IDS as readonly string[]).includes(v as string)
    ? (v as ThemeId)
    : "ledger";
}

export function sanitizeMode(v: unknown): ThemeMode {
  return v === "light" || v === "dark" ? v : "system";
}

export function resolveMode(
  mode: ThemeMode,
  prefersDark: boolean,
): ResolvedMode {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/** TopBar quick-toggle: pin the explicit opposite of what is on screen. */
export function toggleResolvedMode(resolved: ResolvedMode): ThemeMode {
  return resolved === "dark" ? "light" : "dark";
}

/** Spec error handling: matchMedia unavailable (tests/jsdom edge) → treat as dark. */
export function getPrefersDark(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function safeSet(storage: StorageLike, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* storage unavailable — migration is best-effort */
  }
}

/**
 * Read theme+mode, performing the one-time migration:
 * legacy `hive.theme = "light" | "dark"` → `hive.mode`, then `hive.theme = "ledger"`.
 */
export function readStoredState(storage: StorageLike): StoredState {
  let rawTheme: string | null = null;
  let rawMode: string | null = null;
  try {
    rawTheme = storage.getItem(THEME_KEY);
    rawMode = storage.getItem(MODE_KEY);
  } catch {
    return { theme: "ledger", mode: "system" };
  }

  if (rawMode === "light" || rawMode === "dark" || rawMode === "system") {
    return { theme: sanitizeTheme(rawTheme), mode: rawMode };
  }

  if (rawTheme === "light" || rawTheme === "dark") {
    safeSet(storage, MODE_KEY, rawTheme);
    safeSet(storage, THEME_KEY, "ledger");
    return { theme: "ledger", mode: rawTheme };
  }

  return { theme: sanitizeTheme(rawTheme), mode: "system" };
}
