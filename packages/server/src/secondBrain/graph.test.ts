import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { KnowledgeGraph, nodeId } from "./graph";
import type { BrainScope } from "./types";

const makeScope = (scope: BrainScope, root: string) => ({ scope, root });

describe("KnowledgeGraph", () => {
  let tmp: string;
  let scopes: Array<{ scope: BrainScope; root: string }>;
  let graph: KnowledgeGraph;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hive-graph-"));
    scopes = [
      makeScope("global", path.join(tmp, "global")),
      makeScope("project", path.join(tmp, "project")),
    ];
    graph = new KnowledgeGraph(scopes);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("loads empty graph from non-existent files", () => {
    const { nodes, edges } = graph.load();
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it("upserts and loads a node", () => {
    const node = graph.upsertNode("project", {
      id: "preference:terse-commits",
      type: "user_pref",
      label: "Prefers terse commit messages",
      properties: { category: "Writing style" },
    });

    expect(node.id).toBe("preference:terse-commits");
    expect(node.type).toBe("user_pref");
    expect(node.label).toBe("Prefers terse commit messages");

    const loaded = graph.load();
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0].id).toBe("preference:terse-commits");
  });

  it("merges node properties on upsert", () => {
    graph.upsertNode("project", {
      id: "preference:terse-commits",
      type: "user_pref",
      label: "Prefers terse commit messages",
      properties: { category: "Writing style" },
    });

    const updated = graph.upsertNode("project", {
      id: "preference:terse-commits",
      type: "user_pref",
      label: "Prefers terse commit messages",
      properties: { confidence: 0.9 },
    });

    expect(updated.properties).toEqual({
      category: "Writing style",
      confidence: 0.9,
    });
  });

  it("project scope shadows global scope for same node id", () => {
    graph.upsertNode("global", {
      id: "preference:style",
      type: "user_pref",
      label: "Global: formal prose",
    });
    graph.upsertNode("project", {
      id: "preference:style",
      type: "user_pref",
      label: "Project: terse prose",
    });

    const loaded = graph.load();
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0].label).toBe("Project: terse prose");
  });

  it("upserts and loads an edge", () => {
    const edge = graph.upsertEdge("project", {
      type: "influences",
      from: "preference:terse-commits",
      to: "strategy:short-messages",
      strength: 0.8,
    });

    expect(edge.id).toBe("influences|preference:terse-commits|strategy:short-messages");
    expect(edge.strength).toBe(0.8);

    const loaded = graph.load();
    expect(loaded.edges).toHaveLength(1);
    expect(loaded.edges[0].strength).toBe(0.8);
  });

  it("eases edge strength toward new observations", () => {
    graph.upsertEdge("project", {
      type: "influences",
      from: "preference:terse-commits",
      to: "strategy:short-messages",
      strength: 0.3,
    });

    const second = graph.upsertEdge("project", {
      type: "influences",
      from: "preference:terse-commits",
      to: "strategy:short-messages",
      strength: 0.9,
    });

    // Strength should move a third of the way: 0.3 + (0.9 - 0.3) / 3 = 0.5
    expect(second.strength).toBeCloseTo(0.5, 5);
  });

  it("project scope shadows global scope for same edge id", () => {
    graph.upsertEdge("global", {
      type: "influences",
      from: "a",
      to: "b",
      strength: 0.3,
    });
    graph.upsertEdge("project", {
      type: "influences",
      from: "a",
      to: "b",
      strength: 0.9,
    });

    const loaded = graph.load();
    expect(loaded.edges).toHaveLength(1);
    expect(loaded.edges[0].strength).toBe(0.9);
  });

  it("query traverses the graph from a seed node", () => {
    graph.upsertNode("project", {
      id: "preference:terse-commits",
      type: "user_pref",
      label: "Prefers terse commits",
    });
    graph.upsertNode("project", {
      id: "strategy:short-messages",
      type: "task_pattern",
      label: "Use short messages",
    });
    graph.upsertEdge("project", {
      type: "influences",
      from: "preference:terse-commits",
      to: "strategy:short-messages",
      strength: 0.8,
    });

    const hits = graph.query("preference:terse-commits");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].node.id).toBe("strategy:short-messages");
    expect(hits[0].score).toBe(0.8);
  });

  it("query respects depth limit", () => {
    graph.upsertNode("project", { id: "a", type: "user_pref", label: "A" });
    graph.upsertNode("project", { id: "b", type: "task_pattern", label: "B" });
    graph.upsertNode("project", { id: "c", type: "harness_perf", label: "C" });
    graph.upsertEdge("project", { type: "influences", from: "a", to: "b", strength: 0.5 });
    graph.upsertEdge("project", { type: "influences", from: "b", to: "c", strength: 0.5 });

    const hitsDepth1 = graph.query("a", { depth: 1 });
    expect(hitsDepth1.map((h) => h.node.id)).toEqual(["b"]);

    const hitsDepth2 = graph.query("a", { depth: 2 });
    expect(hitsDepth2.map((h) => h.node.id).sort()).toEqual(["b", "c"].sort());
  });

  it("query multiplies edge strengths along path", () => {
    graph.upsertNode("project", { id: "a", type: "user_pref", label: "A" });
    graph.upsertNode("project", { id: "b", type: "task_pattern", label: "B" });
    graph.upsertNode("project", { id: "c", type: "harness_perf", label: "C" });
    graph.upsertEdge("project", { type: "influences", from: "a", to: "b", strength: 0.5 });
    graph.upsertEdge("project", { type: "influences", from: "b", to: "c", strength: 0.5 });

    const hits = graph.query("a", { depth: 2 });
    const hitC = hits.find((h) => h.node.id === "c");
    expect(hitC).toBeDefined();
    // 0.5 * 0.5 = 0.25
    expect(hitC!.score).toBeCloseTo(0.25, 5);
  });

  it("query does not revisit nodes in cycles", () => {
    graph.upsertNode("project", { id: "a", type: "user_pref", label: "A" });
    graph.upsertNode("project", { id: "b", type: "task_pattern", label: "B" });
    graph.upsertEdge("project", { type: "influences", from: "a", to: "b", strength: 0.8 });
    graph.upsertEdge("project", { type: "influences", from: "b", to: "a", strength: 0.8 });

    const hits = graph.query("a", { depth: 3 });
    // Should not go a -> b -> a -> b ...
    const pathA = hits.find((h) => h.node.id === "a");
    expect(pathA).toBeUndefined();
  });

  it("search finds nodes by label or id", () => {
    graph.upsertNode("project", {
      id: "preference:terse-commits",
      type: "user_pref",
      label: "Prefers terse commit messages",
    });
    graph.upsertNode("project", {
      id: "strategy:short-messages",
      type: "task_pattern",
      label: "Terse commit messages are better",
    });

    const results = graph.search("terse");
    expect(results.length).toBe(2);
    expect(results.map((n) => n.id)).toContain("preference:terse-commits");
    expect(results.map((n) => n.id)).toContain("strategy:short-messages");
  });

  it("search is case insensitive", () => {
    graph.upsertNode("project", {
      id: "test",
      type: "user_pref",
      label: "TEST LABEL",
    });

    const results = graph.search("test");
    expect(results).toHaveLength(1);
  });

  it("search returns empty for empty query", () => {
    graph.upsertNode("project", {
      id: "test",
      type: "user_pref",
      label: "Test",
    });

    expect(graph.search("")).toEqual([]);
    expect(graph.search("   ")).toEqual([]);
  });

  it("returns stats with node and edge counts", () => {
    graph.upsertNode("project", { id: "a", type: "user_pref", label: "A" });
    graph.upsertNode("project", { id: "b", type: "task_pattern", label: "B" });
    graph.upsertEdge("project", { type: "influences", from: "a", to: "b", strength: 0.5 });

    const stats = graph.stats();
    expect(stats.nodes).toBe(2);
    expect(stats.edges).toBe(1);
  });
});

describe("nodeId", () => {
  it("produces stable ids", () => {
    expect(nodeId("user_pref", "Prefers terse commits")).toBe(
      "user_pref:prefers-terse-commits",
    );
    expect(nodeId("task_pattern", "Use short messages")).toBe(
      "task_pattern:use-short-messages",
    );
  });

  it("handles special characters", () => {
    expect(nodeId("user_pref", "  --weird--  ")).toBe("user_pref:weird");
  });

  it("truncates long keys", () => {
    const longKey = "a".repeat(100);
    const id = nodeId("user_pref", longKey);
    // "user_pref:" (10 chars) + 60 chars of slug = 70
    expect(id.length).toBeLessThanOrEqual(70);
  });
});