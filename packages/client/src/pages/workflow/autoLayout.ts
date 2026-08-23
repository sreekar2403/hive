import type { HiveEdge, HiveNode } from "./types";

const COLUMN_GAP = 280;
const ROW_GAP = 130;

/**
 * A small layered (Sugiyama-style) auto-layout, hand-rolled so we don't add
 * a dependency for it. Nodes are ranked left-to-right by longest path from
 * any root, then ordered top-to-bottom within a rank by the mean position
 * of their already-placed predecessors, which keeps related branches
 * visually grouped without full crossing minimisation.
 */
export function autoLayout(nodes: HiveNode[], edges: HiveEdge[]): HiveNode[] {
  if (nodes.length === 0) return nodes;

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.target) || !outgoing.has(e.source)) continue;
    incoming.get(e.target)!.push(e.source);
    outgoing.get(e.source)!.push(e.target);
  }

  // Longest-path layering via Kahn's algorithm. Cycle-safe: nodes whose
  // in-degree never reaches zero (because they sit in a cycle) are placed
  // right after their already-ranked predecessors once the queue drains.
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, incoming.get(n.id)!.length);
  const rank = new Map<string, number>();
  for (const n of nodes) rank.set(n.id, 0);

  const queue: string[] = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const visited = new Set<string>();
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    visited.add(id);
    for (const next of outgoing.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      const preds = incoming.get(n.id) ?? [];
      const maxPredRank = preds.reduce((m, p) => Math.max(m, rank.get(p) ?? 0), -1);
      rank.set(n.id, maxPredRank + 1);
    }
  }

  const byRank = new Map<number, string[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(n.id);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);

  for (const r of sortedRanks) {
    const ids = byRank.get(r)!;
    const ordered = ids
      .map((id, idx) => {
        const preds = (incoming.get(id) ?? []).filter((p) => positions.has(p));
        const meanY = preds.length
          ? preds.reduce((sum, p) => sum + positions.get(p)!.y, 0) / preds.length
          : idx * ROW_GAP;
        return { id, meanY };
      })
      .sort((a, b) => a.meanY - b.meanY);

    ordered.forEach(({ id }, idx) => {
      positions.set(id, { x: r * COLUMN_GAP, y: idx * ROW_GAP });
    });
  }

  return nodes.map((n) => {
    const pos = positions.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
}
