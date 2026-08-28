import { describe, expect, it } from "vitest";
import {
  BREAK_SPOTS,
  COFFEE,
  ERRANDS,
  MAILBOX,
  TILE,
  ZONES,
  ZONES_BY_ID,
  buildWalkableGrid,
} from "./layout";

/** BFS reachability over the walkable grid. */
function reachable(grid: boolean[][], from: { x: number; y: number }) {
  const seen = new Set<string>();
  const queue = [from];
  if (!grid[from.y]?.[from.x]) return seen;
  seen.add(`${from.x},${from.y}`);
  while (queue.length) {
    const { x, y } = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (grid[ny]?.[nx]) {
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}

describe("office layout", () => {
  it("uses 32px tiles", () => {
    // Guards against accidental reverts breaking baked-art assumptions.
    expect(TILE).toBe(32);
  });

  it("blocks furniture footprints", () => {
    const grid = buildWalkableGrid();
    // Reception desk in Intake is furniture; agents never stand inside it.
    expect(grid[2][4]).toBe(false);
  });

  it("keeps enclosed rooms reachable through their doors", () => {
    const grid = buildWalkableGrid();
    const open = reachable(grid, { x: 13, y: 15 }); // corridor tile south of Conference

    for (const zone of ZONES) {
      if (!zone.enclosed) continue;
      for (const slot of zone.slots) {
        expect(
          open.has(`${slot.x},${slot.y}`),
          `${zone.id} slot ${slot.x},${slot.y} unreachable`,
        ).toBe(true);
      }
    }
  });

  it("gives every zone slot a walkable tile", () => {
    const grid = buildWalkableGrid();
    for (const zone of ZONES) {
      for (const slot of zone.slots) {
        expect(
          grid[slot.y][slot.x],
          `${zone.id} slot ${slot.x},${slot.y}`,
        ).toBe(true);
      }
    }
  });

  it("anchors the coffee economy on walkable stand tiles", () => {
    const grid = buildWalkableGrid();
    for (const stand of Object.values(COFFEE)) {
      expect(grid[stand.y][stand.x]).toBe(true);
    }
  });

  it("puts errand stands and break spots on walkable tiles", () => {
    const grid = buildWalkableGrid();
    for (const e of ERRANDS) expect(grid[e.stand.y][e.stand.x]).toBe(true);
    for (const s of BREAK_SPOTS) expect(grid[s.y][s.x]).toBe(true);
  });

  it("has a mailbox next to walkable ground", () => {
    const grid = buildWalkableGrid();
    const neighboursWalkable = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => grid[MAILBOX.y + dy]?.[MAILBOX.x + dx]);
    expect(neighboursWalkable).toBe(true);
  });

  it("maps every phase to a zone", () => {
    for (const id of [
      "intake",
      "bullpen",
      "server-room",
      "qa",
      "conference",
      "shipping",
      "break-room",
    ] as const) {
      expect(ZONES_BY_ID[id]).toBeDefined();
    }
  });
});
