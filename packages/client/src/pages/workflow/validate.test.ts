import { describe, it, expect } from "vitest";
import { validateWorkflow } from "./validate";
import type { HiveEdge, HiveNode } from "./types";

function trigger(id = "t"): HiveNode {
  return {
    id,
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { label: "T", triggerKind: "manual" },
  } as HiveNode;
}

function node(
  id: string,
  type: HiveNode["type"],
  data: Record<string, unknown>,
): HiveNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: type, ...data },
  } as HiveNode;
}

function edge(source: string, target: string): HiveEdge {
  return { id: `${source}-${target}`, source, target } as HiveEdge;
}

describe("new-kind validation", () => {
  it("errors when File Write has no path", () => {
    const issues = validateWorkflow(
      [trigger(), node("a", "fileWrite", { path: "", content: "x" })],
      [edge("t", "a")],
    );
    expect(issues.some((i) => i.message.includes("path"))).toBe(true);
  });

  it("passes File Write with a path", () => {
    const issues = validateWorkflow(
      [trigger(), node("a", "fileWrite", { path: "out.md", content: "x" })],
      [edge("t", "a"), edge("a", "t")],
    );
    expect(issues.some((i) => i.message.includes("path"))).toBe(false);
  });

  it("errors when Loop has no items", () => {
    const issues = validateWorkflow(
      [trigger(), node("a", "loop", { items: "", maxIterations: 10 })],
      [edge("t", "a"), edge("a", "t")],
    );
    expect(issues.some((i) => i.message.includes("items"))).toBe(true);
  });

  it("errors when Sub-workflow has no workflow name", () => {
    const issues = validateWorkflow(
      [trigger(), node("a", "subflow", { workflowName: "", input: "" })],
      [edge("t", "a"), edge("a", "t")],
    );
    expect(issues.some((i) => i.message.includes("workflow"))).toBe(true);
  });

  it("warns on unclosed {{ in Prompt Template", () => {
    const issues = validateWorkflow(
      [trigger(), node("a", "promptTemplate", { template: "Hello {{name" })],
      [edge("t", "a"), edge("a", "t")],
    );
    expect(
      issues.some(
        (i) => i.severity === "warning" && i.message.includes("{{"),
      ),
    ).toBe(true);
  });

  it("warns on unknown node kinds instead of crashing", () => {
    const issues = validateWorkflow(
      [trigger(), node("a", "teleport" as never, {})],
      [edge("t", "a"), edge("a", "t")],
    );
    expect(issues.some((i) => i.message.includes("teleport"))).toBe(true);
  });
});
