import type { ZoneDef } from "./layout";
import type { TilePoint } from "./types";

/**
 * Where a character walks in from the first time they appear on the floor,
 * so a new agent enters the office rather than materialising at a desk.
 * Bottom-centre of the open floor, clear of every zone's furniture.
 */
export const ENTRY_TILE: TilePoint = { x: 13, y: 20 };

/**
 * Somewhere near the desk, inside the same room, that this character can
 * plausibly wander to while they think. Returns null when the room has no
 * room to pace in.
 */
export function pickRoamTile(
  grid: boolean[][],
  zone: ZoneDef,
  home: TilePoint,
  radius = 3,
): TilePoint | null {
  const candidates: TilePoint[] = [];
  const { x, y, w, h } = zone.rect;

  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!grid[ty]?.[tx]) continue;
      if (tx === home.x && ty === home.y) continue;
      if (Math.abs(tx - home.x) + Math.abs(ty - home.y) > radius) continue;
      candidates.push({ x: tx, y: ty });
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
