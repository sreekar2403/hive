import * as fs from "fs";
import * as path from "path";
import { LAYOUT, ensureStore } from "./paths";
import type {
  BrainScope,
  GraphEdge,
  GraphEdgeType,
  GraphHit,
  GraphNode,
  GraphNodeType,
} from "./types";

/**
 * The unified knowledge graph (ticket 039-04) — the part that answers
 * questions neither store can answer alone: *"which of my preferences
 * actually correlate with tasks that succeed?"*
 *
 * `mem/graph/nodes.json` + `mem/graph/edges.json`, in a shape that graphify
 * can ingest: a flat node list with `id`/`type`/`label`/`properties`, and a
 * flat edge list with `from`/`to`/`type`/`strength`.
 *
 * The graph is written to one scope at a time (project by default, since
 * most edges are about work done in a particular repo) but *read* across
 * both, with project nodes shadowing global ones of the same id.
 */

interface GraphFile {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class KnowledgeGraph {
  private readonly scopes: Array<{ scope: BrainScope; root: string }>;

  constructor(scopes: Array<{ scope: BrainScope; root: string }>) {
    this.scopes = scopes;
  }

  /** The merged graph across scopes, project last. */
  load(): GraphFile {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();

    for (const { root } of this.scopes) {
      const file = this.readScope(root);
      for (const node of file.nodes) nodes.set(node.id, node);
      for (const edge of file.edges) edges.set(edge.id, edge);
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }

  /**
   * Upserts a node. `properties` is merged rather than replaced, so a
   * caller that only knows one field doesn't wipe out the rest.
   */
  upsertNode(
    scope: BrainScope,
    node: {
      id: string;
      type: GraphNodeType;
      label: string;
      properties?: Record<string, unknown>;
    },
  ): GraphNode {
    const root = this.rootFor(scope);
    const file = this.readScope(root);
    const now = Date.now();
    const existing = file.nodes.find((n) => n.id === node.id);

    const merged: GraphNode = {
      id: node.id,
      type: node.type,
      label: node.label,
      properties: {
        ...(existing?.properties ?? {}),
        ...(node.properties ?? {}),
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    file.nodes = [...file.nodes.filter((n) => n.id !== node.id), merged];
    this.writeScope(root, file);
    return merged;
  }

  /**
   * Upserts an edge. Its id is derived from (type, from, to) so observing
   * the same relationship twice reinforces one edge instead of growing a
   * parallel one — `strength` is what carries repetition, not edge count.
   */
  upsertEdge(
    scope: BrainScope,
    edge: {
      type: GraphEdgeType;
      from: string;
      to: string;
      strength?: number;
      properties?: Record<string, unknown>;
    },
  ): GraphEdge {
    const root = this.rootFor(scope);
    const file = this.readScope(root);
    const now = Date.now();
    const id = edgeId(edge.type, edge.from, edge.to);
    const existing = file.edges.find((e) => e.id === id);

    // Same easing the record store uses for confidence: a third of the way
    // toward each new observation.
    const incoming = clamp01(edge.strength ?? 0.5);
    const strength = existing
      ? clamp01(existing.strength + (incoming - existing.strength) / 3)
      : incoming;

    const merged: GraphEdge = {
      id,
      type: edge.type,
      from: edge.from,
      to: edge.to,
      strength,
      properties: {
        ...(existing?.properties ?? {}),
        ...(edge.properties ?? {}),
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    file.edges = [...file.edges.filter((e) => e.id !== id), merged];
    this.writeScope(root, file);
    return merged;
  }

  /**
   * Breadth-first traversal from a seed node, ranked by the product of edge
   * strengths along the path. Multiplying (rather than summing) is what
   * makes a long chain of weak correlations rank below a short strong one,
   * which is the behaviour you want from an insight query.
   *
   * Edges are followed in both directions: "this preference influences that
   * strategy" is just as interesting read backwards.
   */
  query(
    seedId: string,
    options: { depth?: number; types?: GraphNodeType[]; limit?: number } = {},
  ): GraphHit[] {
    const { nodes, edges } = this.load();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const seed = byId.get(seedId);
    if (!seed) return [];

    const maxDepth = options.depth ?? 2;
    const adjacency = new Map<
      string,
      Array<{ to: string; strength: number }>
    >();
    for (const edge of edges) {
      push(adjacency, edge.from, { to: edge.to, strength: edge.strength });
      push(adjacency, edge.to, { to: edge.from, strength: edge.strength });
    }

    const best = new Map<string, GraphHit>();
    best.set(seedId, { node: seed, depth: 0, score: 1, path: [seedId] });

    let frontier: GraphHit[] = [best.get(seedId)!];
    for (let depth = 1; depth <= maxDepth; depth++) {
      const next: GraphHit[] = [];
      for (const hit of frontier) {
        for (const neighbour of adjacency.get(hit.node.id) ?? []) {
          const node = byId.get(neighbour.to);
          if (!node) continue;
          // A cycle would otherwise re-enter with a strictly worse score
          // forever; keeping only the best path to each node ends it.
          if (hit.path.includes(node.id)) continue;

          const score = hit.score * neighbour.strength;
          const previous = best.get(node.id);
          if (previous && previous.score >= score) continue;

          const found: GraphHit = {
            node,
            depth,
            score,
            path: [...hit.path, node.id],
          };
          best.set(node.id, found);
          next.push(found);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    const hits = Array.from(best.values())
      .filter((h) => h.depth > 0)
      .filter((h) => !options.types || options.types.includes(h.node.type))
      .sort((a, b) => b.score - a.score);

    return options.limit ? hits.slice(0, options.limit) : hits;
  }

  /**
   * Insight query by label rather than by id — what a caller has when the
   * seed is a task category or a prompt keyword, not a node they minted.
   */
  search(text: string, limit = 10): GraphNode[] {
    const needle = text.trim().toLowerCase();
    if (!needle) return [];
    return this.load()
      .nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(needle) ||
          n.id.toLowerCase().includes(needle),
      )
      .slice(0, limit);
  }

  /** Node and edge counts, for the Memory screen. */
  stats(): { nodes: number; edges: number } {
    const { nodes, edges } = this.load();
    return { nodes: nodes.length, edges: edges.length };
  }

  /* ---------------------------------------------------------------- */

  private rootFor(scope: BrainScope): string {
    const root = this.scopes.find((s) => s.scope === scope)?.root;
    if (!root) throw new Error(`Second Brain has no '${scope}' scope`);
    return root;
  }

  private readScope(root: string): GraphFile {
    return {
      nodes: readJsonArray<GraphNode>(path.join(root, LAYOUT.nodes)),
      edges: readJsonArray<GraphEdge>(path.join(root, LAYOUT.edges)),
    };
  }

  private writeScope(root: string, file: GraphFile): void {
    ensureStore(root);
    fs.writeFileSync(
      path.join(root, LAYOUT.nodes),
      `${JSON.stringify(file.nodes, null, 2)}\n`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(root, LAYOUT.edges),
      `${JSON.stringify(file.edges, null, 2)}\n`,
      "utf-8",
    );
  }
}

/** Stable node ids, so two callers describing the same thing agree. */
export function nodeId(type: GraphNodeType, key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${type}:${slug || "unknown"}`;
}

function edgeId(type: GraphEdgeType, from: string, to: string): string {
  return `${type}|${from}|${to}`;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function readJsonArray<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // A half-written graph file shouldn't stop a task from running; the
    // next write rebuilds it from whatever survived.
    return [];
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
