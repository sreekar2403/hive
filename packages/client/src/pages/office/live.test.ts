import { describe, expect, it, vi } from "vitest";
import { LiveActivityStore, mapHarnessEvent } from "./live";

describe("mapHarnessEvent", () => {
  it("maps a running tool call to an icon bubble", () => {
    expect(
      mapHarnessEvent({
        type: "tool",
        tool: "Bash",
        detail: "npm test",
        status: "running",
        at: 0,
      }),
    ).toEqual({ kind: "tool", icon: "$", label: "npm test" });
  });

  it("falls back to the tool name when there is no detail", () => {
    const v = mapHarnessEvent({ type: "tool", tool: "Grep", at: 0 });
    expect(v).toMatchObject({ kind: "tool", icon: "?", label: "Grep" });
  });

  it("uses * for unknown tools", () => {
    const v = mapHarnessEvent({ type: "tool", tool: "mcp__zeta__do", at: 0 });
    expect(v).toMatchObject({ kind: "tool", icon: "*" });
  });

  it("maps thinking events", () => {
    expect(mapHarnessEvent({ type: "thinking", text: "hmm", at: 0 })).toEqual({
      kind: "thinking",
    });
  });

  it("maps error events with clipped text", () => {
    const v = mapHarnessEvent({ type: "error", text: "boom ".repeat(30), at: 0 });
    expect(v?.kind).toBe("error");
    expect((v as { label: string }).label.length).toBeLessThanOrEqual(43);
  });

  it("maps text output to the last line", () => {
    expect(
      mapHarnessEvent({ type: "text", text: "first\nsecond\nthird", at: 0 }),
    ).toEqual({ kind: "output", label: "third" });
  });

  it("ignores usage, status and tool-result events", () => {
    expect(mapHarnessEvent({ type: "usage", at: 0 })).toBeNull();
    expect(mapHarnessEvent({ type: "status", text: "running", at: 0 })).toBeNull();
    expect(
      mapHarnessEvent({ type: "tool-result", callId: "x", at: 0 }),
    ).toBeNull();
  });

  it("ignores empty text events", () => {
    expect(mapHarnessEvent({ type: "text", text: "", at: 0 })).toBeNull();
  });
});

describe("LiveActivityStore", () => {
  function makeStore() {
    return new LiveActivityStore();
  }

  it("routes activity by taskId through the latest roster", () => {
    const store = makeStore();
    const seen: Array<[string, string]> = [];
    store.subscribe((agentId, v) => {
      if (v) seen.push([agentId, v.kind]);
    });

    store.handleRoster([{ id: "agent:pi:1", taskId: "t-42" }]);
    store.ingest("agent:activity", {
      taskId: "t-42",
      event: { type: "tool", tool: "Read", detail: "src/app.ts", at: 0 },
    });

    expect(seen).toEqual([["agent:pi:1", "tool"]]);
    expect(store.current("agent:pi:1")).toMatchObject({ kind: "tool" });
  });

  it("drops activity for tasks nobody on the roster owns", () => {
    const store = makeStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.ingest("agent:activity", {
      taskId: "ghost-task",
      event: { type: "thinking", at: 0 },
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("clears an agent's visual when its task leaves the roster", () => {
    const store = makeStore();
    store.handleRoster([{ id: "a1", taskId: "t1" }]);
    store.ingest("agent:activity", {
      taskId: "t1",
      event: { type: "tool", tool: "Edit", at: 0 },
    });
    store.handleRoster([{ id: "a1", taskId: null }]);
    expect(store.current("a1")).toBeNull();
  });

  it("ignores non-activity SSE types and malformed payloads", () => {
    const store = makeStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.handleRoster([{ id: "a1", taskId: "t1" }]);
    store.ingest("task:started", {});
    store.ingest("agent:activity", { nope: true });
    store.ingest("agent:activity", "junk");
    expect(fn).not.toHaveBeenCalled();
  });
});
