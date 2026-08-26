/**
 * Retro-pixel design tokens for the Office floor.
 *
 * Canonical spec: docs/superpowers/specs/2026-08-25-office-retro-pixel-design.md
 * and docs/office-design.md. Every visual on the floor derives from these
 * constants — no other file may invent a hex value of its own.
 *
 * The office renders in daylight regardless of the app theme (spec D1): it
 * is a diorama, not a themed surface. That daylight is *white* — a paper
 * model on a desk, not a sunlit field. The floor is the least saturated
 * thing on screen so the only colour on it belongs to the agents, and the
 * checkerboards that give the tiles their texture sit a shade or two apart
 * rather than a hue apart.
 */

/** The paper ramp: white through the light greys the floor is built from. */
export const CREAM = {
  50: 0xffffff,
  100: 0xfbfbfd,
  200: 0xf1f2f5,
  300: 0xe3e5ea,
} as const;

export const PAPER = {
  100: 0xffffff,
} as const;

/** Body text and outlines. Never pure black — ink-900 plays that role. */
export const INK = {
  900: 0x22242b,
  700: 0x4b4f5a,
  500: 0x878c99,
  300: 0xc2c7d0,
  100: 0xe6e9ee,
} as const;

/**
 * Identity colours. Softened a step from the arcade originals: on a white
 * floor the saturated versions read as alarms rather than as who-is-who.
 */
export const ACCENTS = {
  coral: 0xef7d7d,
  mint: 0x62c07a,
  sky: 0x45b8b0,
  lemon: 0xe0bb44,
  lilac: 0x9f8ff0,
  peach: 0xef9a72,
} as const;

export const STATUS = {
  idle: 0xb2b7c0,
  thinking: 0x45b8b0,
  working: 0xe0bb44,
  waiting: 0x6c8ef5,
  blocked: 0xef7d7d,
  success: 0x62c07a,
} as const;

/**
 * The floor itself. Three surfaces, each a step apart in value so the plan
 * still reads without any of them carrying a hue:
 *   rooms (wood) are brightest, corridors (path) sit just below them, and
 *   the open floor outside (grass) is a shade cooler again.
 */
export const WORLD = {
  grassLight: 0xedeff3,
  grassDark: 0xe7eaf0,
  woodLight: 0xffffff,
  woodDark: 0xf8f9fb,
  path: 0xf2f4f7,
  wall: 0xd3d8e1,
  /**
   * Furniture, which must not be the same value as the floor it stands on.
   * Desks used to be painted in the floor's own wood tones; once the floor
   * went white they would have disappeared into it, leaving rooms full of
   * free-floating monitors.
   */
  deskTop: 0xe4e9f1,
  deskEdge: 0xc0c8d6,
  /** Hairline around a prop's silhouette, so it reads on a white floor. */
  deskLine: 0x9aa4b5,
} as const;

/** Harness → accent color. Unknown harnesses fall back to lemon. */
export const HARNESS_ACCENT: Record<string, number> = {
  opencode: ACCENTS.sky,
  "claude-code": ACCENTS.coral,
  pi: ACCENTS.lilac,
};

export function accentFor(harness: string): number {
  return HARNESS_ACCENT[harness] ?? ACCENTS.lemon;
}

/** Zone tint → a token from ACCENTS/STATUS so signage matches semantics. */
export const ZONE_TINT_COLOR: Record<string, number> = {
  info: STATUS.thinking,
  ok: STATUS.success,
  warn: STATUS.waiting,
  accent: ACCENTS.peach,
  danger: STATUS.blocked,
  neutral: INK[500],
};

export const MOTION = {
  /** Sprite animation frame time (8 fps). */
  frameMs: 125,
  /** UI snap-in duration for chrome (dialogs, drawers). */
  uiSnapMs: 200,
  /** A busy stretch shorter than this earns no cheer on completion. */
  cheerMinBusyMs: 45_000,
  /** Walk speed in tiles per second. */
  walkTilesPerSec: 2.6,
} as const;
