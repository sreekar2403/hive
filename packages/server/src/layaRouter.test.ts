import { describe, it, expect } from "vitest";
import { Router } from "./router";
import { createDefaultConfig } from "./config";
import { mapCategoryToHarness } from "./laya";
import type { Harness } from "@hive/shared/harness";

import type { LayaPrediction } from "./laya";

const ok: Harness = {
  name: "x",
  isAvailable: async () => true,
  execute: async () => ({
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    output: "",
    filesChanged: [],
    duration: 0,
  }),
  isCompatible: () => true,
};

function pred(): LayaPrediction {
  return {
    category: "test",
    categoryConfidence: 0.95,
    complexity: 0,
    needsStrongModel: 0,
    multiFile: 0,
    risk: 0,
    destructive: 0,
  };
}

describe("laya config defaults", () => {
  it("exposes disabled-by-default laya blocks", () => {
    const c = createDefaultConfig();
    expect(c.routing.laya.enabled).toBe(false);
    expect(c.routing.laya.minConfidence).toBe(0.85);
    expect(c.routing.layaVerify.enabled).toBe(false);
  });
});

describe("mapCategoryToHarness", () => {
  it("maps test to opencode when available", () => {
    expect(
      mapCategoryToHarness("test", ["opencode", "claude-code"], "opencode"),
    ).toBe("opencode");
  });
  it("falls back when mapped harness missing", () => {
    expect(mapCategoryToHarness("test", ["claude-code"], "claude-code")).toBe(
      "claude-code",
    );
  });
});

describe("laya fast-lane", () => {
  it("skips LLM on high-confidence laya hit", async () => {
    const config = createDefaultConfig();
    config.routing.llm.cacheTtlMs = 0;
    config.routing.llm.enabled = false;
    config.routing.laya.enabled = true;
    config.routing.laya.minConfidence = 0.85;
    const router = new Router(
      config,
      new Map([
        ["opencode", ok],
        ["claude-code", ok],
      ]),
      { predict: async () => pred() },
    );
    const r = await router.route("write unit tests", [
      "opencode",
      "claude-code",
    ]);
    expect(r.harness).toBe("opencode");
    expect(r.strategy).toBe("laya");
  });

  it("falls through on low confidence", async () => {
    const config = createDefaultConfig();
    config.routing.llm.enabled = false;
    config.routing.llm.cacheTtlMs = 0;
    config.routing.laya.enabled = true;
    const router = new Router(
      config,
      new Map([
        ["opencode", ok],
        ["claude-code", ok],
      ]),
      {
        predict: async () => ({ ...pred(), categoryConfidence: 0.1 }),
      },
    );
    const r = await router.route("write unit tests for retry", [
      "opencode",
      "claude-code",
    ]);
    expect(r.strategy).not.toBe("laya");
  });

  it("does nothing when disabled", async () => {
    const config = createDefaultConfig();
    config.routing.llm.enabled = false;
    config.routing.llm.cacheTtlMs = 0;
    config.routing.laya.enabled = false;
    const router = new Router(
      config,
      new Map([
        ["opencode", ok],
        ["claude-code", ok],
      ]),
      {
        predict: async () => {
          throw new Error("must not be called");
        },
      },
    );
    const r = await router.route("write unit tests", [
      "opencode",
      "claude-code",
    ]);
    expect(r.strategy).not.toBe("laya");
  });
});
