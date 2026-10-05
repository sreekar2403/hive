import { describe, it, expect } from "vitest";
import { autoLayout } from "./autoLayout";
import type { HiveEdge, HiveNode } from "./types";

/** Shape of a server-drafted graph (see POST /api/workflows/generate). */
function serverGraph(): { nodes: HiveNode[]; edges: HiveEdge[] } {
  const nodes = [
    { id: "n1", type: "trigger", data: { label: "Nightly", triggerKind: "cron" } },
    { id: "n2", type: "agentTask", data: { label: "Run tests", prompt: "x" } },
    { id: "n3", type: "approval", data: { label: "Approve", instructions: "y" } },
    { id: "n4", type: "fileWrite", data: { label: "Save", path: "r.md" } },
  ].map((n, i) => ({
    ...n,
    position: { x: (i % 4) * 280, y: Math.floor(i / 4) * 160 },
  })) as HiveNode[];
  const edges = [
    { id: "e-n1-n2", source: "n1", target: "n2", type: "smoothstep" },
    { id: "e-n2-n3", source: "n2", target: "n3", type: "smoothstep" },
    { id: "e-n3-n4", source: "n3", target: "n4", type: "smoothstep" },
  ] as HiveEdge[];
  return { nodes, edges };
}

describe("autoLayout apply contract", () => {
  it("positions every server-drafted node without losing data", () => {
    const { nodes, edges } = serverGraph();
    const laid = autoLayout(nodes, edges);
    expect(laid).toHaveLength(4);
    for (const n of laid) {
      expect(n.position.x).toBeGreaterThanOrEqual(0);
      expect(n.position.y).toBeGreaterThanOrEqual(0);
    }
    // Left-to-right chain order preserved.
    const xs = laid.map((n) => n.position.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // Node payloads survive layout untouched.
    expect(laid[1].data.label).toBe("Run tests");
    expect((laid[3].data as { path: string }).path).toBe("r.md");
  });

  it("leaves an empty graph alone", () => {
    expect(autoLayout([], [])).toEqual([]);
  });
});
