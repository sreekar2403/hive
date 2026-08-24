import { describe, it, expect, beforeEach } from "vitest";
import { LoopEngine } from "./loopEngine";
import { createDefaultConfig } from "./config";
import type { Harness } from "@hive/shared/harness";

const createMockHarness = (overrides?: Partial<Harness>): Harness => ({
  name: "mock-harness",
  isAvailable: async () => true,
  execute: async () => ({
    success: true,
    exitCode: 0,
    stdout: "success output",
    stderr: "",
    output: "output",
    filesChanged: [],
    duration: 100,
  }),
  isCompatible: () => true,
  ...overrides,
});

describe("LoopEngine", () => {
  let loopEngine: LoopEngine;
  const config = createDefaultConfig();
  const harnesses = new Map<string, Harness>([
    ["opencode", createMockHarness()],
  ]);

  beforeEach(() => {
    loopEngine = new LoopEngine(config, harnesses);
  });

  describe("retry logic", () => {
    it("retries on successful result", () => {
      const result = { success: true, stderr: "" };
      const shouldRetry = (loopEngine as any).shouldRetry(result);
      expect(shouldRetry).toBe(true);
    });

    it("retries on retryable errors", () => {
      const retryableErrors = [
        "syntax error in code",
        "permission denied for file",
        "file not found",
        "connection timeout occurred",
        "connection refused",
      ];

      retryableErrors.forEach((stderr) => {
        const shouldRetry = (loopEngine as any).shouldRetry({
          success: false,
          stderr,
        });
        expect(shouldRetry).toBe(true);
      });
    });

    it("does not retry on non-retryable errors when permissions disabled", () => {
      const configNoPermissions = {
        ...config,
        permission: { ...config.permission, enabled: false },
      };
      const engineNoPerms = new LoopEngine(configNoPermissions, harnesses);
      const result = { success: false, stderr: "some other error" };
      const shouldRetry = (engineNoPerms as any).shouldRetry(result);
      expect(shouldRetry).toBe(false);
    });

    it("does not retry on non-retryable errors", () => {
      const result = { success: false, stderr: "some unrecognized error" };
      const shouldRetry = (loopEngine as any).shouldRetry(result);
      expect(shouldRetry).toBe(false);
    });

    it("builds retry prompt with error context", () => {
      const result = {
        stderr: "syntax error: unexpected token",
        output: "output text",
      };
      const prompt = (loopEngine as any).buildRetryPrompt(result);
      expect(prompt).toContain("previous attempt failed");
      expect(prompt).toContain("syntax error: unexpected token");
      expect(prompt).toContain("different approach");
    });

    it("uses stderr in retry prompt when available", () => {
      const result = {
        stderr: "specific error message",
        output: "generic output",
      };
      const prompt = (loopEngine as any).buildRetryPrompt(result);
      expect(prompt).toContain("specific error message");
    });

    it("falls back to output when stderr is empty", () => {
      const result = {
        stderr: "",
        output: "fallback error text",
      };
      const prompt = (loopEngine as any).buildRetryPrompt(result);
      expect(prompt).toContain("fallback error text");
    });
  });

  describe("state management", () => {
    it("starts with correct initial state", () => {
      const state = loopEngine.start("test prompt");
      expect(state.iteration).toBe(0);
      expect(state.currentPrompt).toBe("test prompt");
      expect(state.success).toBe(false);
      expect(state.maxIterations).toBe(config.loop.maxIterations);
    });

    it("returns a copy of state, not a reference", () => {
      loopEngine.start("test");
      const state1 = loopEngine.getState();
      const state2 = loopEngine.getState();
      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });
  });
});
