export const THEME_IDS = [
  "ledger",
  "slate",
  "canopy",
  "rosewood",
  "graphite",
  "signal",
  "honeycomb",
  "dracula",
  "nord",
  "onedark",
  "github",
  "catppuccin",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

/** Full --hive-* palette for one theme in one resolved mode. */
export interface HivePalette {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentHover: string;
  accentFg: string;
  accentSoft: string;
  accentLine: string;
  success: string;
  successSoft: string;
  info: string;
  infoSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  shadow: string;
  shadowLg: string;
  agentOpencode: string;
  agentClaude: string;
  agentPi: string;
  agentHive: string;
  colorScheme: ResolvedMode;
}

/**
 * Authoring seed: the 12 colors picked in the visual review, plus optional
 * exact overrides (Ledger uses these to stay pixel-identical).
 */
export interface CompactSeed {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentFg: string;
  ok: string;
  info: string;
  warn: string;
  danger: string;
  exact?: Partial<Omit<HivePalette, "colorScheme">>;
}
