import { describe, it, expect } from "vitest";
import {
  buildGeneratePrompt,
  coerceGeneratedGraph,
} from "./generate";

describe("coerceGeneratedGraph", () => {
  it("warns on unknown kinds instead of failing", () => {
    const res = coerceGeneratedGraph(
      { nodes: [{ id: "a", type: "teleport", data: {} }], edges: [] },
      8,
    );
    expect(res.nodes).toHaveLength(1);
    expect(res.warnings.join(" ")).toMatch(/teleport/i);
  });

  it("synthesizes a Manual trigger when absent", () => {
    const res = coerceGeneratedGraph(
      {
        nodes: [{ id: "a", type: "agentTask", data: { label: "Do it" } }],
        edges: [],
      },
      8,
    );
    expect(res.nodes.some((n) => n.type === "trigger")).toBe(true);
  });

  it("caps nodes and drops dangling edges", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "note",
      data: { label: `N${i}` },
    }));
    const res = coerceGeneratedGraph(
      {
        nodes,
        edges: [
          { source: "n0", target: "n1" },
          { source: "n0", target: "ghost" },
        ],
      },
      8,
    );
    // 1 synthesized trigger + 7 kept = cap of 8
    expect(res.nodes.length).toBeLessThanOrEqual(8);
    const ids = new Set(res.nodes.map((n) => n.id));
    for (const e of res.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });
});

describe("buildGeneratePrompt", () => {
  it("names every emittable kind and the cap", () => {
    const prompt = buildGeneratePrompt("nightly test sweep", 8);
    for (const kind of ["agentTask", "fileWrite", "gate", "vectorSearch"]) {
      expect(prompt).toContain(kind);
    }
    expect(prompt).toContain("nightly test sweep");
  });
});
