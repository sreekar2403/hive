import { describe, it, expect } from "vitest";
import { ClaudeCodeHarness } from "./claudeCode";
import { OpenCodeHarness } from "./opencode";
import { PiHarness } from "./pi";
import type { Harness } from "@hive/shared/harness";

describe("Harness interface contract", () => {
  describe("isAvailable", () => {
    it(
      "returns a Promise<boolean>",
      async () => {
        const harnesses: Harness[] = [
          new ClaudeCodeHarness(),
          new OpenCodeHarness(),
          new PiHarness(),
        ];

        for (const harness of harnesses) {
          const result = harness.isAvailable();
          expect(result).toBeInstanceOf(Promise);
          const isAvailable = await result;
          expect(typeof isAvailable).toBe("boolean");
        }
      },
      // Spawns three real CLIs sequentially to probe availability; each can
      // take a few seconds on a cold Windows shell, so the default 5s budget
      // is too tight.
      20000,
    );

    it("handles gracefully when command not found", async () => {
      // Use a non-existent path to test error handling
      const harness = new ClaudeCodeHarness("/nonexistent/path");
      const isAvailable = await harness.isAvailable();
      expect(typeof isAvailable).toBe("boolean");
      expect(isAvailable).toBe(false);
    });
  });

  describe("execute", () => {
    it("execute method exists and returns a Promise", () => {
      const harnesses: Harness[] = [
        new ClaudeCodeHarness(),
        new OpenCodeHarness(),
        new PiHarness(),
      ];

      harnesses.forEach((harness) => {
        expect(typeof harness.execute).toBe("function");
        const result = harness.execute("test", { cwd: process.cwd() });
        expect(result).toBeInstanceOf(Promise);
      });
    });
  });

  describe("isCompatible", () => {
    it("returns a boolean", () => {
      const harness = new ClaudeCodeHarness();
      const result = harness.isCompatible("claude-sonnet-4");
      expect(typeof result).toBe("boolean");
    });

    it("harnesses can declare model compatibility", () => {
      const claudeHarness = new ClaudeCodeHarness("claude", "sonnet");
      const opencodeHarness = new OpenCodeHarness("opencode", "sonnet");
      const piHarness = new PiHarness("pi", "sonnet");

      // Each harness should be compatible with some models
      expect(claudeHarness.isCompatible("sonnet")).toBe(true);
      expect(opencodeHarness.isCompatible("sonnet")).toBe(true);
      expect(piHarness.isCompatible("sonnet")).toBe(true);
    });
  });

  describe("harness properties", () => {
    it("each harness has a name property", () => {
      const harnesses: Harness[] = [
        new ClaudeCodeHarness(),
        new OpenCodeHarness(),
        new PiHarness(),
      ];

      harnesses.forEach((harness) => {
        expect(harness.name).toBeDefined();
        expect(typeof harness.name).toBe("string");
        expect(harness.name.length).toBeGreaterThan(0);
      });
    });

    it("harness names are unique", () => {
      const harnesses: Harness[] = [
        new ClaudeCodeHarness(),
        new OpenCodeHarness(),
        new PiHarness(),
      ];

      const names = harnesses.map((h) => h.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });
});
