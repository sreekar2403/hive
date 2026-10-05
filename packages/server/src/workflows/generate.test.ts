import { describe, it, expect } from "vitest";
import type { Harness } from "@hive/shared/harness";
import { createDefaultConfig } from "../config";
import {
  GenerateError,
  buildGeneratePrompt,
  coerceGeneratedGraph,
  generateWorkflowGraph,
  setGenerateDeps,
} from "./generate";

function fakeHarness(
  output: string,
  success = true,
  stderr = "",
): Harness {
  return {
    name: "fake",
    isAvailable: async () => true,
    execute: async () => ({
      success,
      exitCode: success ? 0 : 1,
      stdout: output,
      stderr,
      output: success ? output : stderr || output,
      filesChanged: [],
      duration: 1,
    }),
    isCompatible: () => true,
  };
}

const GRAPH_JSON = JSON.stringify({
  nodes: [
    { id: "n1", type: "trigger", data: { label: "T", triggerKind: "manual" } },
    {
      id: "n2",
      type: "note",
      data: { label: "N", text: "hi" },
    },
  ],
  edges: [{ source: "n1", target: "n2" }],
});

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

describe("generateWorkflowGraph", () => {
  it("falls back to the next harness when the first fails", async () => {
    setGenerateDeps({
      config: createDefaultConfig(),
      harnesses: new Map<string, Harness>([
        ["broken", fakeHarness("", false, "boom")],
        ["working", fakeHarness(`Here you go: ${GRAPH_JSON}`)],
      ]),
    });
    const graph = await generateWorkflowGraph({
      description: "anything",
      harness: "broken",
    });
    expect(graph.nodes.map((n) => n.type)).toEqual(["trigger", "note"]);
  });

  it("names every failed harness and its reason", async () => {
    setGenerateDeps({
      config: createDefaultConfig(),
      harnesses: new Map<string, Harness>([
        ["opencode", fakeHarness("", false, "Unexpected server error")],
        ["pi", fakeHarness("", false, "OAuth session expired")],
      ]),
    });
    const err = await generateWorkflowGraph({ description: "anything" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GenerateError);
    expect(err.message).toMatch(/opencode/);
    expect(err.message).toMatch(/Unexpected server error/);
    expect(err.message).toMatch(/OAuth session expired/);
  });

  it("503s when nothing is installed", async () => {
    setGenerateDeps({
      config: createDefaultConfig(),
      harnesses: new Map<string, Harness>(),
    });
    const err = await generateWorkflowGraph({ description: "anything" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GenerateError);
    expect((err as GenerateError).status).toBe(503);
  });
});
