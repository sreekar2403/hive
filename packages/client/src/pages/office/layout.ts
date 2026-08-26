import type { TaskPhase, TilePoint } from "./types";

export type { TilePoint };

/**
 * The Office floor's tile grid. Small enough to keep A* trivially fast,
 * big enough that seven zones plus corridors don't feel cramped.
 *
 * TILE is 32 because every baked pixel-art frame assumes it.
 */
export const TILE = 32;
export const COLS = 28;
export const ROWS = 22;

export type ZoneTint = "info" | "ok" | "warn" | "accent" | "danger" | "neutral";

export interface ZoneDef {
  id: TaskPhase;
  label: string;
  sublabel: string;
  rect: { x: number; y: number; w: number; h: number };
  tint: ZoneTint;
  /** Walled rooms (Conference, Server Room) block movement except through `doors`. */
  enclosed?: boolean;
  doors?: TilePoint[];
  /** Tile positions agents actually stand at — always inside `rect` and never furniture. */
  slots: TilePoint[];
}

export type FurnitureKind =
  | "reception"
  | "desk"
  | "rack"
  | "table"
  | "counter"
  | "couch"
  | "boxes"
  // Retro rebuild props (see docs/office-design.md):
  | "sideboard"
  | "coffee-machine"
  | "sink"
  | "dispenser"
  | "plant"
  | "window"
  | "mailbox";

export interface FurnitureDef {
  kind: FurnitureKind;
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * Zone = phase. Each entry here is a real pipeline stage (see
 * packages/server/src/orchestrator.ts's TaskPhase) rendered as a room.
 * Open-plan layout: only Conference Room and Server Room have walls, as
 * both are conventionally enclosed spaces — everything else is one
 * shared floor, distinguished by a tinted wash, furniture, and signage.
 */
export const ZONES: ZoneDef[] = [
  {
    id: "intake",
    label: "Intake",
    sublabel: "Task queued · planning",
    rect: { x: 1, y: 1, w: 7, h: 6 },
    tint: "info",
    slots: [
      { x: 4, y: 3 },
      { x: 2, y: 4 },
    ],
  },
  {
    id: "bullpen",
    label: "Bullpen",
    sublabel: "Implementing · writing code",
    rect: { x: 9, y: 1, w: 12, h: 6 },
    tint: "neutral",
    slots: [
      { x: 10, y: 3 },
      { x: 13, y: 3 },
      { x: 16, y: 3 },
      { x: 10, y: 6 },
      { x: 13, y: 6 },
      { x: 16, y: 6 },
    ],
  },
  {
    id: "server-room",
    label: "Server Room",
    sublabel: "Build · install · infra",
    rect: { x: 22, y: 1, w: 5, h: 6 },
    tint: "danger",
    enclosed: true,
    doors: [{ x: 24, y: 6 }],
    slots: [
      { x: 24, y: 3 },
      { x: 24, y: 5 },
    ],
  },
  {
    id: "qa",
    label: "QA Lab",
    sublabel: "Running tests · verifying",
    rect: { x: 1, y: 9, w: 7, h: 6 },
    tint: "ok",
    slots: [
      { x: 2, y: 11 },
      { x: 5, y: 11 },
      { x: 2, y: 14 },
    ],
  },
  {
    id: "conference",
    label: "Conference Room",
    sublabel: "Awaiting review · permission",
    rect: { x: 9, y: 9, w: 9, h: 6 },
    tint: "warn",
    enclosed: true,
    doors: [{ x: 13, y: 9 }],
    slots: [
      { x: 11, y: 11 },
      { x: 15, y: 11 },
      { x: 11, y: 12 },
      { x: 15, y: 12 },
    ],
  },
  {
    id: "shipping",
    label: "Shipping",
    sublabel: "Committing · opening a PR",
    rect: { x: 19, y: 9, w: 8, h: 6 },
    tint: "accent",
    slots: [
      { x: 22, y: 11 },
      { x: 23, y: 13 },
    ],
  },
  {
    id: "break-room",
    label: "Break Room",
    sublabel: "Idle · no task",
    rect: { x: 1, y: 17, w: 8, h: 4 },
    tint: "neutral",
    slots: [
      { x: 2, y: 19 },
      { x: 8, y: 20 },
      { x: 2, y: 20 },
    ],
  },
];

export const ZONES_BY_ID: Record<TaskPhase, ZoneDef> = Object.fromEntries(
  ZONES.map((z) => [z.id, z]),
) as Record<TaskPhase, ZoneDef>;

/* ------------------------------------------------------------------ */
/* Ambient-life anchors                                                */
/* ------------------------------------------------------------------ */

/**
 * The coffee economy in the Break Room: fetch a clean mug from the
 * sideboard, brew at the machine, rinse it at the sink. Each entry is the
 * tile an agent STANDS on — the prop itself sits one tile north.
 */
export const COFFEE = {
  sideboard: { x: 2, y: 18 },
  machine: { x: 3, y: 18 },
  sink: { x: 4, y: 18 },
} as const;

/** Idle errands: stand tiles next to their props. */
export const ERRANDS: {
  kind: "plant" | "window" | "dispenser";
  stand: TilePoint;
}[] = [
  { kind: "plant", stand: { x: 10, y: 16 } },
  { kind: "plant", stand: { x: 22, y: 7 } },
  { kind: "window", stand: { x: 13, y: 1 } },
  { kind: "dispenser", stand: { x: 6, y: 18 } },
];

/** Where break-room conversations happen. */
export const BREAK_SPOTS: TilePoint[] = [
  { x: 2, y: 19 },
  { x: 5, y: 19 },
  { x: 6, y: 20 },
  { x: 7, y: 20 },
];

/** Completed work is posted here; the flag raises on a completion. */
export const MAILBOX: TilePoint = { x: 26, y: 15 };

export const FURNITURE: FurnitureDef[] = [
  // Intake
  { kind: "reception", rect: { x: 3, y: 2, w: 3, h: 1 } },
  // Bullpen
  { kind: "desk", rect: { x: 10, y: 2, w: 2, h: 1 } },
  { kind: "desk", rect: { x: 13, y: 2, w: 2, h: 1 } },
  { kind: "desk", rect: { x: 16, y: 2, w: 2, h: 1 } },
  { kind: "desk", rect: { x: 10, y: 5, w: 2, h: 1 } },
  { kind: "desk", rect: { x: 13, y: 5, w: 2, h: 1 } },
  { kind: "desk", rect: { x: 16, y: 5, w: 2, h: 1 } },
  // Server Room
  { kind: "rack", rect: { x: 23, y: 2, w: 1, h: 2 } },
  { kind: "rack", rect: { x: 25, y: 2, w: 1, h: 2 } },
  { kind: "rack", rect: { x: 23, y: 4, w: 1, h: 2 } },
  // QA Lab
  { kind: "table", rect: { x: 2, y: 10, w: 2, h: 1 } },
  { kind: "table", rect: { x: 5, y: 10, w: 2, h: 1 } },
  { kind: "table", rect: { x: 2, y: 13, w: 2, h: 1 } },
  // Conference Room
  { kind: "table", rect: { x: 12, y: 11, w: 3, h: 2 } },
  // Shipping
  { kind: "table", rect: { x: 21, y: 10, w: 3, h: 1 } },
  { kind: "boxes", rect: { x: 24, y: 12, w: 2, h: 2 } },
  // Break Room — the coffee corner runs along its top edge
  { kind: "sideboard", rect: { x: 2, y: 17, w: 1, h: 1 } },
  { kind: "coffee-machine", rect: { x: 3, y: 17, w: 1, h: 1 } },
  { kind: "sink", rect: { x: 4, y: 17, w: 1, h: 1 } },
  { kind: "dispenser", rect: { x: 6, y: 17, w: 1, h: 1 } },
  { kind: "couch", rect: { x: 6, y: 19, w: 3, h: 1 } },
  { kind: "table", rect: { x: 3, y: 20, w: 2, h: 1 } },
  // Corridor greenery and wall dressing
  { kind: "plant", rect: { x: 9, y: 16, w: 1, h: 1 } },
  { kind: "plant", rect: { x: 21, y: 7, w: 1, h: 1 } },
  { kind: "window", rect: { x: 12, y: 0, w: 2, h: 1 } },
  // Completed-work mailbox south of Shipping
  { kind: "mailbox", rect: { x: 26, y: 15, w: 1, h: 1 } },
];

/** Tile → world-pixel center, in the world container's local space. */
export function tileCenterPx(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + 0.5) * TILE, y: (tile.y + 0.5) * TILE };
}

/** World-pixel → tile, inverse of tileCenterPx. */
export function pxToTile(pos: { x: number; y: number }): TilePoint {
  return { x: Math.floor(pos.x / TILE), y: Math.floor(pos.y / TILE) };
}

/**
 * Walkable grid, indexed grid[y][x]. The whole inner floor is walkable
 * open-plan by default; furniture footprints and the two enclosed rooms'
 * walls (minus their door gaps) are subtracted out.
 */
export function buildWalkableGrid(): boolean[][] {
  const grid: boolean[][] = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) => x >= 1 && x <= COLS - 2 && y >= 1 && y <= ROWS - 2),
  );

  const setCell = (x: number, y: number, value: boolean) => {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) grid[y][x] = value;
  };

  for (const item of FURNITURE) {
    for (let dx = 0; dx < item.rect.w; dx++) {
      for (let dy = 0; dy < item.rect.h; dy++) {
        setCell(item.rect.x + dx, item.rect.y + dy, false);
      }
    }
  }

  for (const zone of ZONES) {
    if (!zone.enclosed) continue;
    const { x, y, w, h } = zone.rect;
    for (let dx = 0; dx < w; dx++) {
      setCell(x + dx, y, false);
      setCell(x + dx, y + h - 1, false);
    }
    for (let dy = 0; dy < h; dy++) {
      setCell(x, y + dy, false);
      setCell(x + w - 1, y + dy, false);
    }
    for (const door of zone.doors ?? []) setCell(door.x, door.y, true);
  }

  return grid;
}
