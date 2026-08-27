import { describe, it, expect } from "vitest";
import {
  HARNESS_COMMANDS,
  HARNESS_IDS,
  HARNESS_LABELS,
  harnessConfigOr,
  type HarnessConfig,
  type HarnessId,
} from "./types";

/**
 * Regression cover for a crash that took the whole Settings screen down.
 *
 * The harnesses page iterates HARNESS_IDS and read `config.harnesses[id]`
 * directly. When the server sent a config with fewer harness blocks than the
 * client knew about — an older server, or a hand-edited hive.config.json —
 * that read returned undefined and `cfg.enabled` threw during render.
 *
 * The client cannot assume the server agrees with it about which harnesses
 * exist, so the fix is a total function rather than a lookup.
 */

const full = HARNESS_IDS.reduce(
  (acc, id) => {
    acc[id] = {
      enabled: true,
      path: `/usr/local/bin/${id}`,
      defaultModel: "some-model",
      args: [],
      concurrency: 4,
    };
    return acc;
  },
  {} as Record<HarnessId, HarnessConfig>,
);

describe("harnessConfigOr", () => {
  it("returns the real block when the server sent one", () => {
    expect(harnessConfigOr(full, "codex")).toMatchObject({
      enabled: true,
      path: "/usr/local/bin/codex",
      concurrency: 4,
    });
  });

  it("stands in for a harness the config has no block for", () => {
    // Exactly the shape an older server sends: the original three only.
    const legacy = {
      opencode: full.opencode,
      "claude-code": full["claude-code"],
      pi: full.pi,
    };

    for (const id of HARNESS_IDS) {
      const cfg = harnessConfigOr(legacy, id);
      expect(cfg).toBeDefined();
      expect(typeof cfg.enabled).toBe("boolean");
      expect(cfg.path.length).toBeGreaterThan(0);
      expect(Array.isArray(cfg.args)).toBe(true);
    }
  });

  it("defaults a missing harness to disabled rather than silently on", () => {
    expect(harnessConfigOr({}, "amp").enabled).toBe(false);
  });

  it("names the CLI's real binary in the stand-in", () => {
    expect(harnessConfigOr({}, "claude-code").path).toBe("claude");
    expect(harnessConfigOr({}, "cursor-agent").path).toBe("cursor-agent");
  });

  it("survives an entirely empty config without throwing", () => {
    expect(() =>
      HARNESS_IDS.map((id) => harnessConfigOr({}, id)),
    ).not.toThrow();
  });
});

describe("harness tables", () => {
  it("has a label and a command for every id", () => {
    for (const id of HARNESS_IDS) {
      expect(HARNESS_LABELS[id], `label for ${id}`).toBeTruthy();
      expect(HARNESS_COMMANDS[id], `command for ${id}`).toBeTruthy();
    }
  });

  it("lists no duplicates", () => {
    expect(new Set(HARNESS_IDS).size).toBe(HARNESS_IDS.length);
  });
});
