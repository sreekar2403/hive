import type { TilePoint } from "./types";

/**
 * A* over the walkable grid, 4-directional so characters walk along
 * corridors rather than cutting diagonally through desks.
 */
export function findPath(
  grid: boolean[][],
  start: TilePoint,
  goal: TilePoint,
): TilePoint[] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const key = (x: number, y: number) => y * cols + x;
  const inBounds = (x: number, y: number) =>
    x >= 0 && x < cols && y >= 0 && y < rows;

  if (!inBounds(start.x, start.y) || !inBounds(goal.x, goal.y)) return [];
  if (start.x === goal.x && start.y === goal.y) return [];

  // If the goal tile itself is blocked, aim for the nearest walkable
  // neighbour instead of failing outright.
  let target = goal;
  if (!grid[goal.y][goal.x]) {
    const alt = nearestWalkable(grid, goal);
    if (!alt) return [];
    target = alt;
  }

  const heuristic = (x: number, y: number) =>
    Math.abs(x - target.x) + Math.abs(y - target.y);

  const open: Array<{ x: number; y: number; f: number }> = [
    { x: start.x, y: start.y, f: heuristic(start.x, start.y) },
  ];
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[key(start.x, start.y), 0]]);
  const closed = new Set<number>();

  const NEIGHBOURS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  while (open.length) {
    // Small maps, so a linear scan beats the complexity of a real heap.
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIndex].f) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current.x, current.y);

    if (current.x === target.x && current.y === target.y) {
      return reconstruct(cameFrom, currentKey, cols);
    }

    closed.add(currentKey);
    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!inBounds(nx, ny) || !grid[ny][nx]) continue;
      const nKey = key(nx, ny);
      if (closed.has(nKey)) continue;

      const tentative = currentG + 1;
      if (tentative >= (gScore.get(nKey) ?? Infinity)) continue;

      cameFrom.set(nKey, currentKey);
      gScore.set(nKey, tentative);
      const f = tentative + heuristic(nx, ny);
      const existing = open.find((n) => n.x === nx && n.y === ny);
      if (existing) existing.f = f;
      else open.push({ x: nx, y: ny, f });
    }
  }

  return [];
}

function reconstruct(
  cameFrom: Map<number, number>,
  endKey: number,
  cols: number,
): TilePoint[] {
  const path: TilePoint[] = [];
  let k: number | undefined = endKey;
  while (k !== undefined) {
    path.push({ x: k % cols, y: Math.floor(k / cols) });
    k = cameFrom.get(k);
  }
  path.reverse();
  // Drop the start tile — the character is already standing on it.
  return path.slice(1);
}

/** Breadth-first search outward for the closest walkable tile. */
function nearestWalkable(grid: boolean[][], from: TilePoint): TilePoint | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  for (let radius = 1; radius < Math.max(rows, cols); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = from.x + dx;
        const y = from.y + dy;
        if (x >= 0 && x < cols && y >= 0 && y < rows && grid[y][x]) {
          return { x, y };
        }
      }
    }
  }
  return null;
}
