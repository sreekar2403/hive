import type { HivePalette } from "./types";

/** Map the palette onto the --hive-* custom-property contract from index.css. */
export function paletteToCssVars(p: HivePalette): Record<string, string> {
  return {
    "--hive-bg": p.bg,
    "--hive-surface": p.surface,
    "--hive-surface-2": p.surface2,
    "--hive-surface-3": p.surface3,
    "--hive-border": p.border,
    "--hive-border-strong": p.borderStrong,
    "--hive-text": p.text,
    "--hive-text-muted": p.textMuted,
    "--hive-text-faint": p.textFaint,
    "--hive-accent": p.accent,
    "--hive-accent-hover": p.accentHover,
    "--hive-accent-fg": p.accentFg,
    "--hive-accent-soft": p.accentSoft,
    "--hive-accent-line": p.accentLine,
    "--hive-success": p.success,
    "--hive-success-soft": p.successSoft,
    "--hive-info": p.info,
    "--hive-info-soft": p.infoSoft,
    "--hive-warn": p.warn,
    "--hive-warn-soft": p.warnSoft,
    "--hive-danger": p.danger,
    "--hive-danger-soft": p.dangerSoft,
    "--hive-shadow": p.shadow,
    "--hive-shadow-lg": p.shadowLg,
    "--hive-agent-opencode": p.agentOpencode,
    "--hive-agent-claude": p.agentClaude,
    "--hive-agent-pi": p.agentPi,
    "--hive-agent-hive": p.agentHive,
  };
}

export function applyPalette(el: HTMLElement, p: HivePalette): void {
  for (const [key, value] of Object.entries(paletteToCssVars(p))) {
    el.style.setProperty(key, value);
  }
  el.style.setProperty("color-scheme", p.colorScheme);
}
