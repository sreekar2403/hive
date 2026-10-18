import { describe, expect, it } from "vitest";
import {
  MODE_KEY,
  THEME_KEY,
  readStoredState,
  resolveMode,
  sanitizeMode,
  sanitizeTheme,
  toggleResolvedMode,
} from "./resolve";

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    dump: () => Object.fromEntries(m),
  };
}

describe("sanitizeTheme / sanitizeMode", () => {
  it("falls back to ledger / system for unknown values", () => {
    expect(sanitizeTheme("nope")).toBe("ledger");
    expect(sanitizeTheme(null)).toBe("ledger");
    expect(sanitizeTheme("dracula")).toBe("dracula");
    expect(sanitizeMode("blue")).toBe("system");
    expect(sanitizeMode("dark")).toBe("dark");
  });
});

describe("resolveMode", () => {
  it("system follows prefersDark", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
  });
  it("explicit mode ignores the OS", () => {
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });
});

describe("toggleResolvedMode", () => {
  it("flips the resolved mode into an explicit stored mode", () => {
    expect(toggleResolvedMode("dark")).toBe("light");
    expect(toggleResolvedMode("light")).toBe("dark");
  });
});

describe("readStoredState", () => {
  it("defaults to ledger + system on first boot", () => {
    const s = memStorage();
    expect(readStoredState(s)).toEqual({ theme: "ledger", mode: "system" });
  });

  it("migrates legacy hive.theme=dark to mode=dark, theme=ledger", () => {
    const s = memStorage({ [THEME_KEY]: "dark" });
    expect(readStoredState(s)).toEqual({ theme: "ledger", mode: "dark" });
    expect(s.dump()).toEqual({ [THEME_KEY]: "ledger", [MODE_KEY]: "dark" });
  });

  it("migrates legacy hive.theme=light to mode=light", () => {
    const s = memStorage({ [THEME_KEY]: "light" });
    expect(readStoredState(s)).toEqual({ theme: "ledger", mode: "light" });
  });

  it("is idempotent on second boot (no further migration needed)", () => {
    const s = memStorage({ [THEME_KEY]: "dark" });
    readStoredState(s);
    const after = s.dump();
    expect(readStoredState(s)).toEqual({ theme: "ledger", mode: "dark" });
    expect(s.dump()).toEqual(after);
  });

  it("keeps an explicit mode and sanitizes a bad theme id", () => {
    const s = memStorage({ [THEME_KEY]: "hax", [MODE_KEY]: "light" });
    expect(readStoredState(s)).toEqual({ theme: "ledger", mode: "light" });
    // No legacy migration rewrite when mode is already valid.
    expect(s.dump()).toEqual({ [THEME_KEY]: "hax", [MODE_KEY]: "light" });
  });

  it("round-trips a real modern pair", () => {
    const s = memStorage({ [THEME_KEY]: "nord", [MODE_KEY]: "system" });
    expect(readStoredState(s)).toEqual({ theme: "nord", mode: "system" });
  });

  it("survives a throwing storage (migration writes are best-effort)", () => {
    const throwing = {
      getItem: () => "dark",
      setItem: () => {
        throw new Error("nope");
      },
    };
    expect(readStoredState(throwing)).toEqual({
      theme: "ledger",
      mode: "dark",
    });
  });
});
