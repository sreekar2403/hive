import { describe, expect, it } from "vitest";
import { COFFEE, ERRANDS, type TilePoint } from "./layout";
import { decide, type DirectorState } from "./director";

const HOME: TilePoint = { x: 13, y: 6 }; // bullpen desk slot
const base = {
  agentId: "agent:pi:0",
  busy: false,
  arrived: false,
  reduceMotion: false,
  now: 10_000,
  rng: () => 0.99, // never rolls an activity unless a test asks
  homeTile: HOME,
};

describe("decide", () => {
  it("clears any ambient state for busy agents", () => {
    const prev: DirectorState = { phase: "brewing", until: 9999 };
    const r = decide({ ...base, busy: true, state: prev });
    expect(r.state.phase).toBe("idle");
    expect(r.actions).toContainEqual({ type: "clear" });
    expect(r.actions).toContainEqual({ type: "carry", kind: null });
  });

  it("never animates under reduced motion", () => {
    const r = decide({ ...base, reduceMotion: true });
    expect(r.state.phase).toBe("idle");
    expect(r.actions).toEqual([{ type: "clear" }]);
  });

  it("mostly idles", () => {
    const r = decide(base);
    expect(r.state.phase).toBe("idle");
    expect(r.actions).toEqual([]);
  });

  it("starts a coffee run: sideboard → machine → home with a persistent mug", () => {
    const rng = () => 0.05;
    let r = decide({ ...base, rng });
    expect(r.state.phase).toBe("toSideboard");
    expect(r.actions).toContainEqual({
      type: "walkTo",
      target: COFFEE.sideboard,
    });

    r = decide({ ...base, state: r.state, arrived: true, rng: () => 0.99 });
    expect(r.state.phase).toBe("toMachine");
    expect(r.actions).toContainEqual({ type: "carry", kind: "mug" });
    expect(r.actions).toContainEqual({
      type: "walkTo",
      target: COFFEE.machine,
    });

    r = decide({ ...base, state: r.state, arrived: true, rng: () => 0.99 });
    expect(r.state.phase).toBe("brewing");
    const say = r.actions.find((a) => a.type === "say");
    expect(say).toBeDefined();

    // Brewing completes only once its timer lapses.
    const until = (r.state as { until: number }).until;
    r = decide({ ...base, state: r.state, now: until - 1 });
    expect(r.state.phase).toBe("brewing");
    r = decide({ ...base, state: r.state, now: until + 1 });
    expect(r.state.phase).toBe("home");
    expect(r.actions).toContainEqual({ type: "walkTo", target: HOME });

    r = decide({ ...base, state: r.state, arrived: true });
    expect(r.state.phase).toBe("idle");
    expect(r.actions).toContainEqual({ type: "carry", kind: null });
  });

  it("runs an errand with a mutter and returns home", () => {
    const rng = () => 0.4; // above coffee threshold, below activity threshold
    let r = decide({ ...base, rng });
    expect(["toErrand"]).toContain(r.state.phase);
    const errand = ERRANDS.find(
      (e) => e.stand.x === (r.state as { spot?: TilePoint }).spot?.x,
    );
    expect(errand).toBeDefined();
    expect(r.actions.some((a) => a.type === "walkTo")).toBe(true);

    r = decide({ ...base, state: r.state, arrived: true });
    expect(r.state.phase).toBe("doing");
    expect(
      (r.actions.find((a) => a.type === "say") as { text: string }).text.length,
    ).toBeGreaterThan(0);

    const until = (r.state as { until: number }).until;
    r = decide({ ...base, state: r.state, now: until + 1 });
    expect(r.state.phase).toBe("returning");

    r = decide({ ...base, state: r.state, arrived: true });
    expect(r.state.phase).toBe("idle");
    expect(r.actions).toEqual([{ type: "clear" }]);
  });

  it("aborts a run the moment work arrives", () => {
    const rng = () => 0.05;
    const r0 = decide({ ...base, rng });
    const r = decide({ ...base, state: r0.state, busy: true });
    expect(r.state.phase).toBe("idle");
    expect(r.actions).toContainEqual({ type: "clear" });
    expect(r.actions).toContainEqual({ type: "carry", kind: null });
  });
});
