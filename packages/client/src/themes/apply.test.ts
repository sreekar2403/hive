import { describe, expect, it } from "vitest";
import { applyPalette, paletteToCssVars } from "./apply";
import { getPalette } from "./registry";

describe("paletteToCssVars", () => {
  it("emits exactly the 28 --hive-* contract keys", () => {
    const vars = paletteToCssVars(getPalette("nord", "dark"));
    expect(Object.keys(vars).sort()).toEqual(
      [
        "--hive-bg",
        "--hive-surface",
        "--hive-surface-2",
        "--hive-surface-3",
        "--hive-border",
        "--hive-border-strong",
        "--hive-text",
        "--hive-text-muted",
        "--hive-text-faint",
        "--hive-accent",
        "--hive-accent-hover",
        "--hive-accent-fg",
        "--hive-accent-soft",
        "--hive-accent-line",
        "--hive-success",
        "--hive-success-soft",
        "--hive-info",
        "--hive-info-soft",
        "--hive-warn",
        "--hive-warn-soft",
        "--hive-danger",
        "--hive-danger-soft",
        "--hive-shadow",
        "--hive-shadow-lg",
        "--hive-agent-opencode",
        "--hive-agent-claude",
        "--hive-agent-pi",
        "--hive-agent-hive",
      ].sort(),
    );
  });
});

describe("applyPalette", () => {
  it("writes every var and color-scheme onto the element", () => {
    const el = document.createElement("div");
    const p = getPalette("dracula", "dark");
    applyPalette(el, p);
    expect(el.style.getPropertyValue("--hive-bg").trim()).toBe(p.bg);
    expect(el.style.getPropertyValue("--hive-accent").trim()).toBe(p.accent);
    expect(el.style.getPropertyValue("--hive-agent-pi").trim()).toBe(
      p.agentPi,
    );
    expect(el.style.getPropertyValue("color-scheme").trim()).toBe("dark");
  });

  it("replaces prior values on re-apply (no stale palette)", () => {
    const el = document.createElement("div");
    applyPalette(el, getPalette("signal", "light"));
    applyPalette(el, getPalette("ledger", "dark"));
    expect(el.style.getPropertyValue("--hive-bg").trim()).toBe("#0e1013");
    expect(el.style.getPropertyValue("color-scheme").trim()).toBe("dark");
  });
});
