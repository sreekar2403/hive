import { Container, Graphics, Text, TextStyle } from "pixi.js";
import {
  COLS,
  FURNITURE,
  ROWS,
  TILE,
  ZONES,
  type FurnitureDef,
  type ZoneDef,
} from "./layout";

export interface Palette {
  carpet: number;
  carpetAlt: number;
  wall: number;
  wallTrim: number;
  line: number;
  ink: number;
  muted: number;
  faint: number;
  desk: number;
  deskEdge: number;
  partition: number;
  metal: number;
  screen: number;
  signPlate: number;
  tints: Record<string, number>;
}

/**
 * The office reads as a real workplace rather than a game board: flat
 * carpet, grey partitions, wood-tone desks. Only the zone signage carries
 * colour, so the floor stays calm and the characters are what you notice.
 * Structural colours are fixed; theme tokens supply text and signage so
 * labels stay legible in both themes.
 */
export function readPalette(el: HTMLElement, dark: boolean): Palette {
  const cs = getComputedStyle(el);
  const hex = (name: string, fallback: number) =>
    cssColorToHex(cs.getPropertyValue(name).trim()) ?? fallback;

  const structural = dark
    ? {
        carpet: 0x2a2b2f,
        carpetAlt: 0x2f3034,
        wall: 0x3c3e44,
        wallTrim: 0x4a4d54,
        desk: 0x6f5842,
        deskEdge: 0x5a4636,
        partition: 0x45484f,
        metal: 0x585c64,
        screen: 0x8fb8d8,
        signPlate: 0x1d1f24,
      }
    : {
        carpet: 0xd8d4cb,
        carpetAlt: 0xdedad1,
        wall: 0xbdb9b0,
        wallTrim: 0xa9a49a,
        desk: 0xb08c62,
        deskEdge: 0x94734d,
        partition: 0xc3bfb6,
        metal: 0x9a9ea6,
        screen: 0x5b8dd9,
        signPlate: 0xf4f3ef,
      };

  return {
    ...structural,
    line: hex("--hive-border", dark ? 0x262b33 : 0xdcdcd5),
    ink: hex("--hive-text", dark ? 0xe9e7e2 : 0x15181d),
    muted: hex("--hive-text-muted", dark ? 0x8b919c : 0x6b7079),
    faint: hex("--hive-text-faint", dark ? 0x656b75 : 0x9aa0a8),
    tints: {
      info: hex("--hive-info", 0x5b8dd9),
      ok: hex("--hive-success", 0x4fa97c),
      warn: hex("--hive-warn", 0xd9a441),
      accent: hex("--hive-accent", 0xe8a33d),
      danger: hex("--hive-danger", 0xd9584c),
      neutral: hex("--hive-text-faint", 0x8b919c),
    },
  };
}

function cssColorToHex(value: string): number | null {
  if (!value) return null;
  if (value.startsWith("#")) {
    const h = value.slice(1);
    const full =
      h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full.slice(0, 6), 16);
    return Number.isNaN(n) ? null : n;
  }
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(/[,\s/]+/).map(Number);
    if ([r, g, b].some(Number.isNaN)) return null;
    return (r << 16) | (g << 8) | b;
  }
  return null;
}

/** Draws the static office: carpet, walls, zone signage, furniture. */
export function buildFloor(palette: Palette): Container {
  const layer = new Container();

  layer.addChild(drawCarpet(palette));
  for (const zone of ZONES) layer.addChild(drawZoneFloor(zone, palette));
  layer.addChild(drawPerimeter(palette));
  for (const zone of ZONES) {
    if (zone.enclosed) layer.addChild(drawRoomWalls(zone, palette));
  }

  const furniture = new Graphics();
  for (const item of FURNITURE) drawFurniture(furniture, item, palette);
  layer.addChild(furniture);

  for (const zone of ZONES) layer.addChild(drawZoneSign(zone, palette));

  return layer;
}

/** Flat carpet with a faint weave — no checkerboard. */
function drawCarpet(palette: Palette): Graphics {
  const g = new Graphics();
  g.rect(0, 0, COLS * TILE, ROWS * TILE).fill(palette.carpet);
  for (let y = 0; y < ROWS * TILE; y += 6) {
    g.rect(0, y, COLS * TILE, 1).fill({ color: palette.carpetAlt, alpha: 0.5 });
  }
  return g;
}

/** A slightly different carpet tone marks each zone's footprint. */
function drawZoneFloor(zone: ZoneDef, palette: Palette): Graphics {
  const { x, y, w, h } = zone.rect;
  const g = new Graphics();
  g.rect(x * TILE, y * TILE, w * TILE, h * TILE).fill({
    color: palette.carpetAlt,
    alpha: 0.9,
  });
  g.rect(x * TILE, y * TILE, w * TILE, h * TILE).stroke({
    color: palette.tints[zone.tint] ?? palette.muted,
    width: 1,
    alpha: 0.22,
  });
  return g;
}

function drawPerimeter(palette: Palette): Graphics {
  const g = new Graphics();
  const w = COLS * TILE;
  const h = ROWS * TILE;
  g.rect(0, 0, w, TILE).fill(palette.wall);
  g.rect(0, h - TILE, w, TILE).fill(palette.wall);
  g.rect(0, 0, TILE, h).fill(palette.wall);
  g.rect(w - TILE, 0, TILE, h).fill(palette.wall);
  g.rect(TILE - 2, TILE - 2, w - 2 * TILE + 4, h - 2 * TILE + 4).stroke({
    color: palette.wallTrim,
    width: 2,
  });
  return g;
}

function drawRoomWalls(zone: ZoneDef, palette: Palette): Graphics {
  const g = new Graphics();
  const { x, y, w, h } = zone.rect;
  const put = (cx: number, cy: number) =>
    g.rect(cx * TILE, cy * TILE, TILE, TILE).fill(palette.wall);

  for (let dx = 0; dx < w; dx++) {
    put(x + dx, y);
    put(x + dx, y + h - 1);
  }
  for (let dy = 0; dy < h; dy++) {
    put(x, y + dy);
    put(x + w - 1, y + dy);
  }
  // Door gaps read as openings, not painted-over wall.
  for (const door of zone.doors ?? []) {
    g.rect(door.x * TILE, door.y * TILE, TILE, TILE).fill(palette.carpetAlt);
    g.rect(door.x * TILE, door.y * TILE, TILE, 3).fill(palette.wallTrim);
  }
  return g;
}

/** An office sign: small plate with a colour tab, mounted top-left. */
function drawZoneSign(zone: ZoneDef, palette: Palette): Container {
  const c = new Container();
  const tint = palette.tints[zone.tint] ?? palette.muted;
  const px = zone.rect.x * TILE + 5;
  const py = zone.rect.y * TILE + (zone.enclosed ? TILE + 4 : 4);

  const label = new Text({
    text: zone.label.toUpperCase(),
    style: new TextStyle({
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: 8.5,
      fontWeight: "600",
      letterSpacing: 1.1,
      fill: palette.ink,
      // pixi under-measures the texture when letterSpacing is set and
      // clips the final glyph without it.
      padding: 4,
    }),
  });
  const sub = new Text({
    text: zone.sublabel,
    style: new TextStyle({
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: 7,
      fill: palette.muted,
      padding: 4,
    }),
  });

  const width = Math.max(label.width, sub.width) + 14;
  const plate = new Graphics();
  plate.roundRect(px, py, width, 22, 2).fill({ color: palette.signPlate, alpha: 0.92 });
  plate.roundRect(px, py, width, 22, 2).stroke({ color: tint, width: 1, alpha: 0.5 });
  plate.rect(px, py, 3, 22).fill(tint);

  label.x = px + 8;
  label.y = py + 3;
  sub.x = px + 8;
  sub.y = py + 12;

  c.addChild(plate, label, sub);
  return c;
}

function drawFurniture(g: Graphics, item: FurnitureDef, palette: Palette) {
  const { x, y, w, h } = item.rect;
  const px = x * TILE;
  const py = y * TILE;
  const pw = w * TILE;
  const ph = h * TILE;

  const desktop = (color: number, edge: number) => {
    g.roundRect(px + 2, py + 3, pw - 4, ph - 5, 2).fill(edge);
    g.roundRect(px + 2, py + 2, pw - 4, ph - 5, 2).fill(color);
  };

  switch (item.kind) {
    case "desk":
    case "reception": {
      desktop(palette.desk, palette.deskEdge);
      // Cubicle partition along the back edge.
      g.rect(px + 2, py - 3, pw - 4, 5).fill(palette.partition);
      // Monitor + keyboard, so a desk reads as a workstation.
      const mx = px + pw / 2;
      g.rect(mx - 1.5, py + 9, 3, 4).fill(palette.metal);
      g.roundRect(mx - 8, py + 2, 16, 9, 1).fill(palette.metal);
      g.roundRect(mx - 7, py + 3, 14, 7, 1).fill(palette.screen);
      g.roundRect(mx - 6, py + 14, 12, 3, 1).fill(palette.metal);
      break;
    }
    case "table": {
      desktop(palette.desk, palette.deskEdge);
      // Chairs around the table.
      for (let i = 0; i < w; i++) {
        g.circle(px + TILE * (i + 0.5), py - 5, 4).fill(palette.metal);
        g.circle(px + TILE * (i + 0.5), py + ph + 5, 4).fill(palette.metal);
      }
      break;
    }
    case "counter": {
      desktop(palette.metal, palette.wallTrim);
      // Coffee machine.
      g.roundRect(px + 6, py + 2, 10, 14, 2).fill(palette.wallTrim);
      g.rect(px + 8, py + 12, 6, 3).fill(palette.desk);
      break;
    }
    case "couch": {
      g.roundRect(px + 3, py + 4, pw - 6, ph - 6, 4).fill(palette.partition);
      g.roundRect(px + 3, py + 1, pw - 6, 7, 3).fill(palette.metal);
      break;
    }
    case "rack": {
      g.roundRect(px + 3, py + 2, pw - 6, ph - 4, 2).fill(palette.metal);
      g.roundRect(px + 3, py + 2, pw - 6, ph - 4, 2).stroke({
        color: palette.wallTrim,
        width: 1,
      });
      for (let i = 0; i < h * 3; i++) {
        g.rect(px + 6, py + 6 + i * 9, pw - 12, 4).fill({
          color: palette.tints.ok,
          alpha: 0.65,
        });
      }
      break;
    }
    case "boxes": {
      for (let i = 0; i < 2; i++) {
        const bx = px + 4 + i * 14;
        g.roundRect(bx, py + 8 - i * 4, 13, 13, 1).fill(palette.desk);
        g.rect(bx, py + 13 - i * 4, 13, 2).fill(palette.deskEdge);
      }
      break;
    }
  }
}
