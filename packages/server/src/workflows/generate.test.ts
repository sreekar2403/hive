import { describe, it, expect } from "vitest";
import type { Harness } from "@hive/shared/harness";
import { createDefaultConfig } from "../config";
import {
  GenerateError,
  buildGeneratePrompt,
  coerceGeneratedGraph,
  generateWorkflowGraph,
  isDegenerateGraph,
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
      type: "fileRead",
      data: { label: "Read", pattern: "research/**/*.md" },
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

  it("stays short enough for cmd.exe CLIs", () => {
    // pi/codex/claude fall back to cmd.exe (8191-char limit) when their
    // shims don't resolve — see winShim.ts. A prompt past that dies with
    // "command line too long" instead of drafting.
    const prompt = buildGeneratePrompt("x".repeat(2000), 8);
    expect(prompt.length).toBeLessThan(7500);
  });

  it("spells out the drafting contract", () => {
    const prompt = buildGeneratePrompt("anything", 8);
    // Process + output contract + hard rules + anti-patterns + checklist.
    expect(prompt).toMatch(/trigger-only drafts fail/i);
    expect(prompt).toMatch(/sourceHandle/);
    expect(prompt).toMatch(/concrete/i);
    expect(prompt).toMatch(/anti-patterns/i);
    expect(prompt).toMatch(/checklist:/i);
    // Required fields are marked so the model fills them, not blanks them.
    expect(prompt).toContain("!prompt");
    expect(prompt).toContain("!path");
  });
});

describe("coerceGeneratedGraph edges", () => {
  it("strips sourceHandles from non-gate edges (they unanchor the edge)", () => {
    const res = coerceGeneratedGraph(
      {
        nodes: [
          { id: "n1", type: "trigger", data: { label: "T" } },
          { id: "n2", type: "fileRead", data: { label: "R" } },
        ],
        edges: [{ source: "n1", target: "n2", sourceHandle: "true" }],
      },
      8,
    );
    expect(res.edges).toHaveLength(1);
    expect(res.edges[0]).not.toHaveProperty("sourceHandle");
    expect(res.warnings.join(" ")).toMatch(/handle/i);
  });

  it("keeps gate true/false branch handles", () => {
    const res = coerceGeneratedGraph(
      {
        nodes: [
          { id: "n1", type: "trigger", data: { label: "T" } },
          { id: "n2", type: "gate", data: { label: "G", condition: "x" } },
          { id: "n3", type: "note", data: { label: "A" } },
          { id: "n4", type: "note", data: { label: "B" } },
        ],
        edges: [
          { source: "n1", target: "n2" },
          { source: "n2", target: "n3", sourceHandle: "true" },
          { source: "n2", target: "n4", sourceHandle: "false" },
        ],
      },
      8,
    );
    expect(
      res.edges.find((e) => e.target === "n3")?.sourceHandle,
    ).toBe("true");
    expect(
      res.edges.find((e) => e.target === "n4")?.sourceHandle,
    ).toBe("false");
  });

  it("collapses duplicate pairs and chains the unwired remainder", () => {
    const res = coerceGeneratedGraph(
      {
        nodes: [
          { id: "n1", type: "trigger", data: { label: "T" } },
          { id: "n2", type: "note", data: { label: "A" } },
          { id: "n3", type: "note", data: { label: "B" } },
        ],
        edges: [
          { source: "n1", target: "n2" },
          { source: "n1", target: "n2" },
        ],
      },
      8,
    );
    const pairs = res.edges.map((e) => `${e.source}>${e.target}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    // n2->n3 chained (n3 had no incoming), n1->n2 kept once.
    expect(pairs).toContain("n1>n2");
    expect(pairs).toContain("n2>n3");
  });
});

describe("isDegenerateGraph", () => {
  it("rejects trigger-only and trigger-plus-note drafts", () => {
    expect(isDegenerateGraph([{ type: "trigger" }])).toBe(true);
    expect(
      isDegenerateGraph([{ type: "trigger" }, { type: "note" }]),
    ).toBe(true);
  });

  it("accepts a draft with one working step", () => {
    expect(
      isDegenerateGraph([{ type: "trigger" }, { type: "fileRead" }]),
    ).toBe(false);
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
    expect(graph.nodes.map((n) => n.type)).toEqual(["trigger", "fileRead"]);
    expect(graph.draftedBy).toBe("working");
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

  it("rejects a trigger-only draft instead of previewing nothing", async () => {
    setGenerateDeps({
      config: createDefaultConfig(),
      harnesses: new Map<string, Harness>([
        [
          "thin",
          fakeHarness(
            JSON.stringify({
              nodes: [
                {
                  id: "n1",
                  type: "trigger",
                  data: { label: "T", triggerKind: "manual" },
                },
              ],
              edges: [],
            }),
          ),
        ],
      ]),
    });
    const err = await generateWorkflowGraph({ description: "anything" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GenerateError);
    expect((err as GenerateError).status).toBe(422);
    expect((err as Error).message).toMatch(/no working steps/i);
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
