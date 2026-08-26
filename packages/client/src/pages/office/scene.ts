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
import { drawProp, type PropKind } from "./pixelArt";
import { CREAM, INK, WORLD, ZONE_TINT_COLOR } from "./retroTheme";

/**
 * The static office, baked once: an open floor around white-floored rooms
 * joined by corridors, light walls, pixel props, and a signpost per zone.
 *
 * Daylight white palette (spec D1, retuned) — the diorama does not follow
 * the app theme. Structure is carried by *value*, not by colour: the plan
 * has to read at a glance without any surface competing with the agents
 * standing on it. Every child carries zIndex = its world-space foot line so
 * characters sort believably against furniture and walls.
 */

const DESK_VARIANTS: PropKind[] = ["desk-open", "desk-dual", "desk-laptop"];

/**
 * Signage sorts above everything static.
 *
 * A signpost is a label for a room, not an object standing in it, so it
 * has no business being occluded by the furniture it names — the Server
 * Room's title used to disappear behind its own racks, which sort at their
 * foot line two rows lower. Well below the bubbles' 1_000_000, so an agent
 * speaking in front of a sign still reads.
 */
const SIGN_Z = 800_000;

export function buildFloor(): Container {
  const layer = new Container();
  layer.sortableChildren = true;

  // Ground pass: one flat Graphics, always beneath everything.
  const ground = new Graphics();
  ground.zIndex = -Infinity;
  drawGrass(ground);
  drawPaths(ground);
  for (const zone of ZONES) drawZoneFloor(ground, zone);
  layer.addChild(ground);

  drawPerimeter(layer);

  for (const item of FURNITURE) {
    const holder = new Container();
    const g = new Graphics();
    drawProp(g, propKindFor(item), item.rect.w, item.rect.h);
    g.x = item.rect.x * TILE;
    g.y = item.rect.y * TILE;
    // Sort by the prop's visual foot line: multi-tile props sort at their
    // bottom edge so agents walking "behind" them are occluded correctly.
    holder.addChild(g);
    holder.zIndex = (item.rect.y + item.rect.h) * TILE;
    layer.addChild(holder);
  }

  for (const zone of ZONES) {
    if (zone.enclosed) drawRoomWalls(layer, zone);
    layer.addChild(drawSignpost(zone));
  }

  return layer;
}

/** Legacy kinds map onto retro props; desks cycle through three flavours. */
function propKindFor(item: FurnitureDef): PropKind {
  if (item.kind === "desk") {
    return DESK_VARIANTS[(item.rect.x + item.rect.y) % DESK_VARIANTS.length];
  }
  return item.kind;
}

function drawGrass(g: Graphics): void {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      g.rect(x * TILE, y * TILE, TILE, TILE).fill(
        (x + y) % 2 === 0 ? WORLD.grassLight : WORLD.grassDark,
      );
    }
  }
}

/** Sand paths: the two corridor belts plus the vertical connectors. */
function drawPaths(g: Graphics): void {
  const belt = (x: number, y: number, w: number, h: number) => {
    g.rect(x * TILE, y * TILE, w * TILE, h * TILE).fill(WORLD.path);
  };
  belt(1, 7, COLS - 2, 2);
  belt(1, 15, COLS - 2, 2);
  belt(8, 1, 1, 19);
  belt(18, 9, 1, 8);
  belt(21, 1, 1, 19);
}

function drawZoneFloor(g: Graphics, zone: ZoneDef): void {
  const { x, y, w, h } = zone.rect;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      g.rect((x + dx) * TILE, (y + dy) * TILE, TILE, TILE).fill(
        (x + dx + y + dy) % 2 === 0 ? WORLD.woodLight : WORLD.woodDark,
      );
    }
  }
  // One accent stripe along the zone's north edge ties signage to space.
  // Held at half strength: it is a label for the room, not a feature of it.
  g.rect(x * TILE, y * TILE, w * TILE, 2).fill({
    color: ZONE_TINT_COLOR[zone.tint] ?? INK[500],
    alpha: 0.5,
  });
}

function drawPerimeter(layer: Container): void {
  const g = new Graphics();
  const w = COLS * TILE;
  const h = ROWS * TILE;
  const t = TILE;

  const wallBand = (x: number, y: number, ww: number, hh: number) => {
    g.rect(x, y, ww, hh).fill(WORLD.wall);
    // A lit top edge and one soft shadow line are enough to read as a wall.
    // The old hard ink outline framed the whole floor like a border, which
    // is most of what made it feel boxed in.
    g.rect(x, y, ww, 1).fill({ color: CREAM[50], alpha: 0.7 });
    g.rect(x, y + hh - 1, ww, 1).fill({ color: INK[500], alpha: 0.45 });
  };

  wallBand(0, 0, w, t);
  wallBand(0, h - t, w, t);
  wallBand(0, 0, t, h);
  wallBand(w - t, 0, t, h);

  g.zIndex = 0; // perimeter sits at the outermost rows anyway
  layer.addChild(g);
}

function drawRoomWalls(layer: Container, zone: ZoneDef): void {
  const { x, y, w, h } = zone.rect;
  const doors = new Set((zone.doors ?? []).map((d) => `${d.x},${d.y}`));

  const seg = new Graphics();
  const put = (cx: number, cy: number, door: boolean) => {
    const px = cx * TILE;
    const py = cy * TILE;
    if (door) {
      // Doorway: floor continues through, threshold strip marks the gap.
      seg.rect(px, py, TILE, TILE).fill(WORLD.path);
      seg
        .rect(px, py + TILE - 3, TILE, 3)
        .fill({ color: INK[500], alpha: 0.3 });
      return;
    }
    seg.rect(px, py, TILE, TILE).fill(WORLD.wall);
    seg.rect(px, py, TILE, 1).fill({ color: CREAM[50], alpha: 0.7 });
    seg.rect(px, py + TILE - 1, TILE, 1).fill({ color: INK[500], alpha: 0.45 });
  };

  for (let dx = 0; dx < w; dx++) {
    put(x + dx, y, doors.has(`${x + dx},${y}`));
    put(x + dx, y + h - 1, doors.has(`${x + dx},${y + h - 1}`));
  }
  for (let dy = 1; dy < h - 1; dy++) {
    put(x, y + dy, doors.has(`${x},${y + dy}`));
    put(x + w - 1, y + dy, doors.has(`${x + w - 1},${y + dy}`));
  }

  // North walls sort just below characters standing in the room's first
  // interior row; side/south walls sort at their own foot lines.
  const holder = new Container();
  holder.addChild(seg);
  holder.zIndex = y * TILE + TILE - 1;
  layer.addChild(holder);
}

/**
 * Zone signpost: a small white card with the zone's tint down its left
 * edge, standing in the room's corner.
 *
 * It used to be a wooden plank in a 2px black box, which put a second heavy
 * rectangle inside every room. The card carries the same information at a
 * fraction of the weight — the tint chip does the identifying, and the
 * border only has to separate the card from the floor beneath it.
 */
function drawSignpost(zone: ZoneDef): Container {
  const c = new Container();
  const px = zone.rect.x * TILE + 4;
  // A walled room wears its sign on the wall itself — the one row inside its
  // footprint that neither furniture nor an agent ever occupies. Open zones
  // keep theirs just inside the top edge.
  const py = zone.rect.y * TILE + (zone.enclosed ? 1 : 6);
  const tint = ZONE_TINT_COLOR[zone.tint] ?? INK[500];

  const g = new Graphics();
  if (!zone.enclosed) g.rect(px + 5, py + 12, 3, 12).fill(INK[300]); // post
  g.rect(px, py, 14 * 8, 22).fill(CREAM[50]); // card (resized after measure)
  // No zIndex here: any zIndex on a child makes pixi sort this container's
  // children, which would lift the plank above the labels it sits behind.
  c.addChild(g);

  const label = new Text({
    text: zone.label.toUpperCase(),
    style: new TextStyle({
      fontFamily: "'Pixelify Sans', monospace",
      fontSize: 13,
      fill: INK[900],
      padding: 4,
    }),
  });
  const sub = new Text({
    text: zone.sublabel.split("·")[0].trim(),
    style: new TextStyle({
      fontFamily: "'Pixelify Sans', monospace",
      fontSize: 11,
      fill: INK[500],
      padding: 4,
    }),
  });

  const width = Math.max(label.width, sub.width) + 14;
  // Repaint the plank to the measured width. Height fits both text lines
  // (14px label + 12px sublabel) with a 2px breathing gap top and bottom.
  const height = 30;
  const plank = c.children[0] as Graphics;
  plank.clear();
  if (!zone.enclosed) {
    plank
      .rect(px + Math.round(width / 2) - 2, py + height - 2, 3, 12)
      .fill(INK[300]);
  }
  plank.rect(px, py, width, height).fill(CREAM[50]);
  plank.rect(px, py, width, height).stroke({ color: INK[300], width: 1 });
  plank.rect(px, py, 3, height).fill(tint);

  label.x = px + 8;
  label.y = py + 2;
  sub.x = px + 8;
  sub.y = py + 16;
  c.addChild(label, sub);
  c.zIndex = SIGN_Z + py;
  return c;
}
