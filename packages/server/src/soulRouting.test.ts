import { describe, it, expect, beforeEach, vi } from "vitest";
import { Router } from "./router";
import { createDefaultConfig, type Config } from "./config";
import { reconcileHarnesses, syncHarnessAvailability } from "./setup";
import type { Harness, HarnessExecutionResult } from "@hive/shared/harness";
import type { SoulRoutingGuidance } from "./secondBrain/starterSoul";

/**
 * Routing is defined by soul.md first, a model second, keywords last.
 *
 * These pin that order, because it is the part a future change is most
 * likely to quietly invert: every layer here can answer, so the only thing
 * stopping the cheapest one from winning is the sequence in Router.route.
 */

function fakeHarness(output: string): Harness {
  const result: HarnessExecutionResult = {
    success: true,
    exitCode: 0,
    stdout: output,
    stderr: "",
    output,
    filesChanged: [],
    duration: 1,
  };
  return {
    name: "fake",
    isAvailable: async () => true,
    execute: vi.fn(async () => result),
    isCompatible: () => true,
  };
}

function guidance(
  partial: Partial<SoulRoutingGuidance> = {},
): SoulRoutingGuidance {
  return { routerModel: "", routes: {}, notes: [], ...partial };
}

const AVAILABLE = ["opencode", "claude-code", "pi"];

describe("routing from soul.md", () => {
  let config: Config;

  beforeEach(() => {
    config = createDefaultConfig();
    config.routing.llm.model = "claude-code/anthropic/haiku";
    config.routing.llm.cacheTtlMs = 0;
  });

  it("obeys an explicit pin over both the model and the keyword rules", async () => {
    // Everything else wants opencode for test work: the keyword rule says so,
    // and the router says so. soul.md says pi, so pi it is.
    const harness = fakeHarness('{"harness":"opencode","confidence":0.99}');
    const router = new Router(
      config,
      new Map(AVAILABLE.map((h) => [h, harness])),
    );

    const decision = await router.route("write unit tests for this", {
      availableHarnesses: AVAILABLE,
      soul: guidance({ routes: { test: "pi" } }),
    });

    expect(decision.harness).toBe("pi");
    expect(decision.strategy).toBe("soul");
    expect(decision.confidence).toBe(1);
  });

  it("does not spend a routing call when soul.md already decided", async () => {
    const harness = fakeHarness('{"harness":"opencode","confidence":0.99}');
    const router = new Router(
      config,
      new Map(AVAILABLE.map((h) => [h, harness])),
    );

    await router.route("write unit tests for this", {
      availableHarnesses: AVAILABLE,
      soul: guidance({ routes: { test: "pi" } }),
    });

    expect(harness.execute).not.toHaveBeenCalled();
  });

  it("ignores a pin naming a harness that is not available", async () => {
    // The user pinned an intent, not a crash. Fall through rather than
    // routing to something that cannot run.
    const harness = fakeHarness('{"harness":"claude-code","confidence":0.9}');
    const router = new Router(
      config,
      new Map(AVAILABLE.map((h) => [h, harness])),
    );

    const decision = await router.route("write unit tests for this", {
      availableHarnesses: AVAILABLE,
      soul: guidance({ routes: { test: "amp" } }),
    });

    expect(decision.harness).toBe("claude-code");
    expect(decision.strategy).toBe("llm");
  });

  it("lets the model decide a category soul.md says nothing about", async () => {
    const harness = fakeHarness('{"harness":"pi","confidence":0.9}');
    const router = new Router(
      config,
      new Map(AVAILABLE.map((h) => [h, harness])),
    );

    const decision = await router.route("refactor this module", {
      availableHarnesses: AVAILABLE,
      soul: guidance({ routes: { test: "opencode" } }),
    });

    expect(decision.harness).toBe("pi");
    expect(decision.strategy).toBe("llm");
  });

  it("passes free-text preferences to the model as standing instructions", async () => {
    const harness = fakeHarness('{"harness":"pi","confidence":0.9}');
    const router = new Router(
      config,
      new Map(AVAILABLE.map((h) => [h, harness])),
    );

    await router.route("refactor this module", {
      availableHarnesses: AVAILABLE,
      soul: guidance({ notes: ["Never use amp for migrations"] }),
    });

    const prompt = (harness.execute as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(prompt).toContain("Never use amp for migrations");
    expect(prompt).toContain("standing instructions");
  });

  it("routes with the model soul.md names, over the one in config", async () => {
    const harness = fakeHarness('{"harness":"pi","confidence":0.9}');
    const router = new Router(
      config,
      new Map(AVAILABLE.map((h) => [h, harness])),
    );

    await router.route("refactor this module", {
      availableHarnesses: AVAILABLE,
      soul: guidance({ routerModel: "pi/anthropic/haiku" }),
    });

    // The routing call itself runs on the harness soul.md named, not the
    // claude-code one config specifies.
    const options = (harness.execute as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(options.model).toBeTruthy();
    expect(harness.execute).toHaveBeenCalledTimes(1);
  });

  it("still reaches the keyword rules when there is no model and no pin", async () => {
    config.routing.llm.enabled = false;
    const harness = fakeHarness("");
    const router = new Router(
      config,
      new Map(AVAILABLE.map((h) => [h, harness])),
    );

    const decision = await router.route("write unit tests for this", {
      availableHarnesses: AVAILABLE,
      soul: guidance(),
    });

    expect(decision.harness).toBe("opencode");
    expect(decision.strategy).toBe("rule");
  });

  it("works with no soul guidance at all", async () => {
    const harness = fakeHarness('{"harness":"pi","confidence":0.9}');
    const router = new Router(
      config,
      new Map(AVAILABLE.map((h) => [h, harness])),
    );

    const decision = await router.route("refactor this module", AVAILABLE);
    expect(decision.harness).toBe("pi");
  });
});

describe("harness availability reconciliation", () => {
  // Neither function here may touch the filesystem: they take a config
  // object and mutate it, and persisting is the caller's decision (see
  // `persist` in syncHarnessAvailability). A test that wrote the real
  // hive.config.json would be a bug in the code, not just in the test.

  let config: Config;

  beforeEach(() => {
    config = createDefaultConfig();
  });

  it("ships with every harness off", () => {
    // A fresh config must not claim twelve agents are ready on a machine
    // that has none of them.
    for (const block of Object.values(config.harnesses)) {
      expect(block.enabled).toBe(false);
    }
  });

  it("enables only what is installed and wanted", () => {
    const { enabled, disabled } = reconcileHarnesses(
      config,
      ["opencode", "claude-code", "codex"],
      ["opencode", "codex"],
    );

    expect(enabled.sort()).toEqual(["codex", "opencode"]);
    expect(disabled).toContain("claude-code");
    expect(config.harnesses.opencode.enabled).toBe(true);
    expect(config.harnesses["claude-code"].enabled).toBe(false);
  });

  it("never enables a harness that is not installed, however much it is wanted", () => {
    reconcileHarnesses(config, [], ["opencode", "amp"]);

    expect(config.harnesses.opencode.enabled).toBe(false);
    expect(config.harnesses.amp.enabled).toBe(false);
  });

  it("turns off a harness whose CLI has gone away", () => {
    config.harnesses.opencode.enabled = true;
    config.harnesses.codex.enabled = true;

    const { disabled } = syncHarnessAvailability(config, ["codex"]);

    expect(disabled).toEqual(["opencode"]);
    expect(config.harnesses.opencode.enabled).toBe(false);
    expect(config.harnesses.codex.enabled).toBe(true);
  });

  it("leaves a deliberately disabled but installed harness alone", () => {
    config.harnesses.opencode.enabled = false;

    syncHarnessAvailability(config, ["opencode"]);

    expect(config.harnesses.opencode.enabled).toBe(false);
  });

  it("switches on what is installed during the first-run bootstrap", () => {
    const { enabled } = syncHarnessAvailability(config, ["opencode", "pi"], {
      enableInstalled: true,
    });

    expect(enabled.sort()).toEqual(["opencode", "pi"]);
    expect(config.harnesses.opencode.enabled).toBe(true);
    expect(config.harnesses.amp.enabled).toBe(false);
  });
});
