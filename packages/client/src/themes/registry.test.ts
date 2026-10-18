import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import {
  THEME_META,
  THEME_ORDER,
  getPalette,
  themeGroups,
} from "./registry";
import { THEME_IDS, type HivePalette } from "./types";

const TOKEN_KEYS = [
  "bg", "surface", "surface2", "surface3", "border", "borderStrong",
  "text", "textMuted", "textFaint",
  "accent", "accentHover", "accentFg", "accentSoft", "accentLine",
  "success", "successSoft", "info", "infoSoft",
  "warn", "warnSoft", "danger", "dangerSoft",
  "shadow", "shadowLg",
  "agentOpencode", "agentClaude", "agentPi", "agentHive",
] as const satisfies readonly (keyof HivePalette)[];

const MODES = ["light", "dark"] as const;

describe("theme registry", () => {
  it("has 12 unique ids, ledger first in THEME_ORDER", () => {
    expect(THEME_IDS).toHaveLength(12);
    expect(new Set(THEME_IDS).size).toBe(12);
    expect(THEME_ORDER[0]).toBe("ledger");
    expect(new Set(THEME_ORDER)).toEqual(new Set(THEME_IDS));
  });

  it("every theme × mode defines every palette token as #hex or rgb(", () => {
    const FREEFORM = new Set<string>(["shadow", "shadowLg"]);
    for (const id of THEME_IDS) {
      for (const mode of MODES) {
        const p = getPalette(id, mode);
        for (const key of TOKEN_KEYS) {
          const v = p[key] as string;
          expect(v, `${id}/${mode}/${key}`).toBeTruthy();
          if (FREEFORM.has(key)) {
            // Box-shadow stacks are free-form but must stay rgb()-based.
            expect(v, `${id}/${mode}/${key}`).toContain("rgb(");
          } else {
            expect(v, `${id}/${mode}/${key}`).toMatch(
              /^(#[0-9a-f]{6}|rgb\()/,
            );
          }
        }
        expect(p.colorScheme, `${id}/${mode}`).toBe(mode);
      }
    }
  });

  it("ledger light/dark match the legacy index.css values exactly", () => {
    const l = getPalette("ledger", "light");
    expect(l).toMatchObject({
      bg: "#f3f3f0",
      surface: "#ffffff",
      surface2: "#ecece8",
      surface3: "#e2e2dd",
      border: "#dcdcd5",
      borderStrong: "#c4c4ba",
      text: "#15181d",
      textMuted: "#6b7079",
      textFaint: "#9aa0a8",
      accent: "#a9701a",
      accentHover: "#8d5c12",
      accentFg: "#ffffff",
      accentSoft: "rgb(169 112 26 / 0.1)",
      accentLine: "rgb(169 112 26 / 0.32)",
      success: "#2f7a5a",
      successSoft: "rgb(47 122 90 / 0.12)",
      info: "#3a63b0",
      infoSoft: "rgb(58 99 176 / 0.12)",
      warn: "#96690f",
      warnSoft: "rgb(150 105 15 / 0.13)",
      danger: "#b23b31",
      dangerSoft: "rgb(178 59 49 / 0.11)",
      shadow:
        "0 1px 2px rgb(21 24 29 / 0.06), 0 4px 12px rgb(21 24 29 / 0.05)",
      shadowLg: "0 8px 32px rgb(21 24 29 / 0.14)",
      agentOpencode: "#1f8f77",
      agentClaude: "#c2532a",
      agentPi: "#4f52c4",
      agentHive: "#a9701a",
      colorScheme: "light",
    });
    const d = getPalette("ledger", "dark");
    expect(d).toMatchObject({
      bg: "#0e1013",
      surface: "#15181d",
      surface2: "#1c2026",
      surface3: "#242931",
      border: "#262b33",
      borderStrong: "#39404b",
      text: "#e9e7e2",
      textMuted: "#8b919c",
      textFaint: "#656b75",
      accent: "#e8a33d",
      accentHover: "#f2b354",
      accentFg: "#16130c",
      accentSoft: "rgb(232 163 61 / 0.14)",
      accentLine: "rgb(232 163 61 / 0.38)",
      success: "#4fa97c",
      successSoft: "rgb(79 169 124 / 0.15)",
      info: "#5b8dd9",
      infoSoft: "rgb(91 141 217 / 0.15)",
      warn: "#d9a441",
      warnSoft: "rgb(217 164 65 / 0.15)",
      danger: "#d9584c",
      dangerSoft: "rgb(217 88 76 / 0.15)",
      shadow: "0 1px 2px rgb(0 0 0 / 0.4), 0 4px 14px rgb(0 0 0 / 0.3)",
      shadowLg: "0 10px 40px rgb(0 0 0 / 0.55)",
      agentOpencode: "#35c9a6",
      agentClaude: "#ff8a5c",
      agentPi: "#8b8ef0",
      agentHive: "#e8a33d",
      colorScheme: "dark",
    });
  });

  it("accent-fg is readable on accent (>=3:1) and text on bg (>=4.5:1) everywhere", () => {
    for (const id of THEME_IDS) {
      for (const mode of MODES) {
        const p = getPalette(id, mode);
        expect(
          contrastRatio(p.accentFg, p.accent),
          `${id}/${mode} accentFg on accent`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          contrastRatio(p.text, p.bg),
          `${id}/${mode} text on bg`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("themeGroups lists Hive originals first with ledger leading", () => {
    const groups = themeGroups();
    expect(groups.map((g) => g.label)).toEqual([
      "Hive originals",
      "Editor-inspired",
    ]);
    expect(groups[0].ids[0]).toBe("ledger");
    expect(groups[0].ids).toHaveLength(7);
    expect(groups[1].ids).toHaveLength(5);
    expect(THEME_META.dracula.group).toBe("editor");
    expect(THEME_META.signal.group).toBe("hive");
  });
});
