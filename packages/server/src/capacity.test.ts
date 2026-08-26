import { describe, expect, it } from "vitest";
import os from "os";
import { detectSystemCapacity, effectiveAgentLimit } from "./capacity";
import { ConcurrencyGate } from "./orchestrator";

describe("detectSystemCapacity", () => {
  it("describes the machine it is running on", () => {
    const capacity = detectSystemCapacity();
    expect(capacity.cpus).toBe(os.cpus().length);
    expect(capacity.totalMemMb).toBeGreaterThan(0);
    expect(capacity.platform).toBe(os.platform());
  });

  it("always recommends at least one agent and never an unbounded number", () => {
    const { recommendedAgents } = detectSystemCapacity();
    expect(recommendedAgents).toBeGreaterThanOrEqual(1);
    // Past a handful the limit stops being this machine and starts being
    // the provider's rate limit.
    expect(recommendedAgents).toBeLessThanOrEqual(8);
  });

  it("leaves a core for the machine's owner", () => {
    const { cpus, recommendedAgents } = detectSystemCapacity();
    if (cpus > 1) expect(recommendedAgents).toBeLessThanOrEqual(cpus - 1);
  });
});

describe("effectiveAgentLimit", () => {
  it("honours an explicit limit", () => {
    expect(effectiveAgentLimit(4)).toBe(4);
  });

  it("treats 0 and undefined as 'decide for me'", () => {
    const auto = detectSystemCapacity().recommendedAgents;
    expect(effectiveAgentLimit(0)).toBe(auto);
    expect(effectiveAgentLimit(undefined)).toBe(auto);
  });

  it("ignores a nonsense negative limit rather than deadlocking on it", () => {
    expect(effectiveAgentLimit(-3)).toBeGreaterThanOrEqual(1);
  });

  it("floors a fractional limit", () => {
    expect(effectiveAgentLimit(2.7)).toBe(2);
  });
});

describe("ConcurrencyGate", () => {
  it("admits runs up to the limit without waiting", async () => {
    const gate = new ConcurrencyGate(() => 2);
    await gate.acquire();
    await gate.acquire();
    expect(gate.active).toBe(2);
    expect(gate.queued).toBe(0);
  });

  it("queues the run past the limit until a slot frees", async () => {
    const gate = new ConcurrencyGate(() => 1);
    await gate.acquire();

    let admitted = false;
    const waiting = gate.acquire().then(() => {
      admitted = true;
    });

    // Still holding the only slot.
    await Promise.resolve();
    expect(admitted).toBe(false);
    expect(gate.queued).toBe(1);

    gate.release();
    await waiting;
    expect(admitted).toBe(true);
    expect(gate.active).toBe(1);
  });

  it("admits waiters in arrival order", async () => {
    const gate = new ConcurrencyGate(() => 1);
    await gate.acquire();

    const order: number[] = [];
    const first = gate.acquire().then(() => order.push(1));
    const second = gate.acquire().then(() => order.push(2));

    gate.release();
    await first;
    gate.release();
    await second;

    expect(order).toEqual([1, 2]);
  });

  it("does not admit anyone while a lowered limit is still exceeded", async () => {
    let limit = 2;
    const gate = new ConcurrencyGate(() => limit);
    await gate.acquire();
    await gate.acquire();

    let admitted = false;
    void gate.acquire().then(() => {
      admitted = true;
    });

    // Settings dropped the limit to 1 while two runs are in flight.
    limit = 1;
    gate.release();
    await Promise.resolve();
    expect(admitted).toBe(false);

    gate.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(admitted).toBe(true);
  });

  it("never counts below zero when released more than acquired", () => {
    const gate = new ConcurrencyGate(() => 1);
    gate.release();
    expect(gate.active).toBe(0);
  });
});
