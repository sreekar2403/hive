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
    it(
      "execute method exists and returns a Promise",
      async () => {
        // Deliberately pointed at binaries that do not exist. This test only
        // checks the shape of the interface, and it used to spawn the three
        // real CLIs to do it — which meant a live model call per harness on
        // a developer machine (slow, billed, non-deterministic) and three
        // ENOENT spawn errors on CI. Both were the same mistake.
        const harnesses: Harness[] = [
          new ClaudeCodeHarness("/nonexistent/claude"),
          new OpenCodeHarness("/nonexistent/opencode"),
          new PiHarness("/nonexistent/pi"),
        ];

        // The promises are awaited rather than left floating: an unawaited
        // rejection here killed the vitest worker *after* the test passed.
        const results = await Promise.all(
          harnesses.map((harness) => {
            expect(typeof harness.execute).toBe("function");
            const result = harness.execute("test", { cwd: process.cwd() });
            expect(result).toBeInstanceOf(Promise);
            return result;
          }),
        );

        // A missing binary is reported as a failed run, never thrown.
        for (const result of results) {
          expect(result.success).toBe(false);
          expect(result.exitCode).toBe(127);
        }
      },
      20000,
    );
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
