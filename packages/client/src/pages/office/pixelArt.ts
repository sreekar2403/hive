import { Graphics, RenderTexture, Renderer, Texture } from "pixi.js";
import { CREAM, INK, WORLD } from "./retroTheme";

/**
 * Procedural pixel-art kit for the office floor.
 *
 * Everything is drawn with 2px-unit rects on integer coordinates — no
 * antialiased diagonals, no fractional positions — then baked to
 * RenderTextures with NEAREST sampling so zooming keeps hard pixel edges.
 * Zero binary assets: if it renders, it was drawn here.
 */

/** The pixel unit: every authored coordinate is multiplied by this. */
export const PX = 2;

type G = Graphics;

/** Paint one unit-cell rect. Coordinates are in pixel units, not world px. */
export function u(
  g: G,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha = 1,
): void {
  g.rect(x * PX, y * PX, w * PX, h * PX).fill({ color, alpha });
}

/** 1px ink outline around an authoring-space box. */
export function boxOutline(
  g: G,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number = INK[900],
): void {
  g.rect(x * PX, y * PX, w * PX, h * PX).stroke({ color, width: 1 });
}

/**
 * Bake a drawing pass into a texture. The graphics is rendered once at
 * 1:1; NEAREST sampling keeps every edge crisp under camera zoom.
 */
export function bakeTexture(
  renderer: Renderer,
  wPx: number,
  hPx: number,
  draw: (g: G) => void,
): Texture {
  const g = new Graphics();
  draw(g);
  const rt = RenderTexture.create({
    width: Math.max(1, wPx),
    height: Math.max(1, hPx),
  });
  rt.source.scaleMode = "nearest";
  renderer.render({ container: g, target: rt });
  g.destroy();
  return rt;
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export type PropKind =
  | "reception"
  | "desk-open"
  | "desk-dual"
  | "desk-laptop"
  | "rack"
  | "table"
  | "counter"
  | "couch"
  | "boxes"
  | "sideboard"
  | "coffee-machine"
  | "sink"
  | "dispenser"
  | "plant"
  | "window"
  | "mailbox";

/**
 * Paint a prop inside a `w×h` tile footprint. All coordinates derive from
 * TILE/PX so a tile-size change stays consistent.
 */
export function drawProp(
  g: G,
  kind: PropKind,
  wTiles: number,
  hTiles: number,
): void {
  const T = 32 / PX; // tile size in authoring units (16)
  const W = wTiles * T;
  const H = hTiles * T;
  // Props read against the floor, not with it — see WORLD.deskTop.
  const wood: number = WORLD.deskTop;
  const woodDark: number = WORLD.deskEdge;
  const metal: number = INK[500];
  const screenOff: number = INK[700];
  const ink: number = INK[900];

  /**
   * A prop's top face, its shaded front edge, and an outline.
   *
   * The outline is what makes a desk a desk on a white floor: without it a
   * light grey slab on a white room reads as a smudge, and the room looks
   * like scattered monitors floating on nothing.
   */
  const topSurface = (color = wood, edge = woodDark, inset = 1) => {
    u(g, inset, inset + 1, W - inset * 2, H - inset - 1, edge);
    u(g, inset, inset, W - inset * 2, H - inset - 1, color);
    boxOutline(g, inset, inset, W - inset * 2, H - inset, WORLD.deskLine);
  };

  switch (kind) {
    case "reception": {
      topSurface(wood, woodDark);
      // Front panel + little bell.
      u(g, 1, H - 4, W - 2, 3, woodDark);
      u(g, W / 2 - 1, 2, 2, 2, ACCENT_GOLD);
      break;
    }
    case "desk-open":
    case "desk-dual":
    case "desk-laptop": {
      topSurface();
      // Partition along the back edge.
      u(g, 0, 0, W, 2, INK[300]);
      u(g, 0, 2, W, 1, INK[100]);
      if (kind === "desk-dual") {
        crt(g, W * 0.22, 3, screenOff);
        crt(g, W * 0.58, 3, screenOff);
        u(g, W * 0.44, H - 5, 4, 1, metal); // keyboard strip
      } else if (kind === "desk-laptop") {
        u(g, W / 2 - 3, 4, 6, 5, metal);
        u(g, W / 2 - 2, 5, 4, 3, screenOff);
        u(g, W / 2 - 4, 9, 8, 1, ink);
      } else {
        crt(g, W / 2 - 4, 3, screenOff);
        u(g, W / 2 - 3, H - 5, 7, 1, metal);
        u(g, W / 2 + 4, H - 5, 2, 1, ACCENT_GOLD); // mouse
      }
      break;
    }
    case "rack": {
      // Server rack: dark frame, blinking lights are runtime FX, not baked.
      u(g, 1, 1, W - 2, H - 2, INK[700]);
      u(g, 2, 2, W - 4, H - 4, INK[900]);
      for (let y = 3; y + 1 < H - 2; y += 4) {
        u(g, 3, y, W - 6, 2, INK[700]);
        u(g, W - 6, y + 1, 1, 1, STATUSY_GREEN);
      }
      break;
    }
    case "table": {
      topSurface(wood, woodDark, 2);
      // Stools north and south.
      for (let i = 0; i < wTiles; i++) {
        u(g, i * T + T / 2 - 2, -2, 4, 2, metal);
        u(g, i * T + T / 2 - 2, H, 4, 2, metal);
      }
      break;
    }
    case "counter": {
      topSurface(INK[300], metal);
      break;
    }
    case "couch": {
      u(g, 0, 2, W, H - 3, INK[500]);
      u(g, 1, 3, W - 2, H - 5, ACCENTS_PLUM);
      u(g, 0, 0, W, 3, INK[700]); // backrest
      u(g, 2, H - 2, W - 4, 1, INK[900]);
      break;
    }
    case "boxes": {
      for (let i = 0; i < 2; i++) {
        const bx = 2 + i * 7;
        u(g, bx, H - 9 + i * -4, 6, 6, wood);
        u(g, bx, H - 9 + i * -4, 6, 1, woodDark);
        u(g, bx + 2, H - 7 + i * -4, 2, 1, INK[300]);
      }
      break;
    }
    case "sideboard": {
      topSurface(wood, woodDark);
      // Mugs waiting on the shelf.
      for (let i = 0; i < Math.floor(W / 5); i++) {
        u(g, 3 + i * 5, 2, 2, 2, ACCENTS[i % 3] ?? ACCENT_GOLD);
      }
      break;
    }
    case "coffee-machine": {
      u(g, 2, 1, W - 4, H - 2, INK[700]);
      u(g, 3, 2, W - 6, H - 5, INK[900]);
      u(g, 4, 3, W - 8, 2, ACCENT_SKY_DARK); // carafe
      u(g, W / 2 - 1, H - 4, 2, 2, ACCENT_GOLD); // drip plate
      u(g, W - 5, 2, 2, 1, ACCENTS_CORAL_SOFT); // power dot
      break;
    }
    case "sink": {
      topSurface(metal, INK[700]);
      u(g, 3, 3, W - 6, H - 7, INK[700]);
      u(g, 4, 4, W - 8, H - 9, INK[900]);
      u(g, W / 2 - 1, 0, 2, 3, ACCENT_GOLD); // tap
      break;
    }
    case "dispenser": {
      u(g, 3, 0, W - 6, 3, INK[700]);
      u(g, 4, 3, W - 8, H - 5, ACCENT_SKY_LIGHT);
      u(g, 5, 4, W - 10, H - 8, ACCENT_SKY_DARK);
      u(g, W / 2 - 1, H - 2, 2, 2, ink);
      break;
    }
    case "plant": {
      // Terracotta pot + stacked leaf clusters.
      u(g, W / 2 - 3, H - 5, 6, 5, ACCENT_TERRA);
      u(g, W / 2 - 4, H - 6, 8, 2, ACCENT_TERRA_DARK);
      u(g, W / 2 - 1, H - 10, 2, 4, ACCENT_LEAF_DARK);
      u(g, W / 2 - 4, H - 12, 4, 3, ACCENT_LEAF);
      u(g, W / 2, H - 13, 4, 3, ACCENT_LEAF);
      u(g, W / 2 - 2, H - 15, 3, 2, ACCENT_LEAF_DARK);
      break;
    }
    case "window": {
      // Sits ON wall tiles: sky glass + cross muntin.
      u(g, 1, 2, W - 2, H - 4, ACCENT_SKY_LIGHT);
      u(g, 2, 3, W - 4, H - 6, ACCENT_SKY_DARK);
      u(g, 2, 3, W - 4, 2, CREAM[50]); // cloud band
      u(g, W / 2 - 1, 2, 2, H - 4, WORLD.wall);
      u(g, 1, H / 2 - 1, W - 2, 2, WORLD.wall);
      boxOutline(g, 1, 2, W - 2, H - 4);
      break;
    }
    case "mailbox": {
      // Post + box; flag raised/lowered at runtime by repainting this tile.
      u(g, W / 2 - 1, H / 2, 2, H / 2, woodDark);
      u(g, 2, 2, W - 4, H / 2 - 1, ACCENTS_CORAL_SOFT);
      boxOutline(g, 2, 2, W - 4, H / 2 - 1);
      u(g, W - 5, 0, 1, 3, ACCENT_GOLD); // flag (up)
      break;
    }
  }
}

/* Accent shorthands kept private — public code uses retroTheme tokens. */
const ACCENT_GOLD = 0xffd93d;
const ACCENTS = [0xff6b6b, 0x4ecdc4, 0xb197fc];
const ACCENTS_CORAL_SOFT = 0xffa07a;
const ACCENT_SKY_DARK = 0x2f8f88;
const ACCENT_SKY_LIGHT = 0xa8e6e0;
const ACCENT_TERRA = 0xc97b4a;
const ACCENT_TERRA_DARK = 0xa35d33;
const ACCENT_LEAF = 0x6bcf7f;
const ACCENT_LEAF_DARK = 0x3e9955;
const ACCENTS_PLUM = 0xb197fc;
const STATUSY_GREEN = 0x6bcf7f;

/** A chunky CRT monitor with its screen switched off. */
function crt(g: G, xUnits: number, yUnits: number, screenColor: number): void {
  const x = Math.round(xUnits);
  u(g, x, yUnits, 8, 7, INK[500]);
  u(g, x + 1, yUnits + 1, 6, 4, screenColor);
  u(g, x + 2, yUnits + 6, 4, 1, INK[900]); // stand hint
}

/**
 * Lit-screen overlay: repaints a CRT's screen with a desktop wash plus two
 * printing log lines and a blinking cursor (page ticks the phase).
 */
export function drawScreenOn(
  g: G,
  xUnits: number,
  yUnits: number,
  phase: number,
): void {
  const x = Math.round(xUnits);
  u(g, x + 1, yUnits + 1, 6, 4, 0x2e5f8a); // desktop wash
  u(g, x + 2, yUnits + 2, 4, 1, 0x89c4f4); // titlebar
  for (let i = 0; i < 2; i++) {
    const p = (phase * 0.9 + i * 0.47) % 1;
    const w = 1 + Math.floor(p * 4);
    u(g, x + 2, yUnits + 3 + i, w, 1, 0xffffff, 0.85 - i * 0.3);
  }
  if (Math.floor(phase * 2.6) % 2 === 0) {
    u(g, x + 2, yUnits + 4, 1, 1, 0xffffff, 0.95); // cursor
  }
}
