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

    it("retries transient errors regardless of the permission setting", () => {
      // Retry behaviour and the approval gate are unrelated features; the
      // engine used to disable retries entirely when permissions were off.
      const configNoPermissions = {
        ...config,
        permission: { ...config.permission, enabled: false },
      };
      const engineNoPerms = new LoopEngine(configNoPermissions, harnesses);

      expect(
        (engineNoPerms as any).shouldRetry({
          success: false,
          stderr: "connection timeout occurred",
        }),
      ).toBe(true);
      expect(
        (engineNoPerms as any).shouldRetry({
          success: false,
          stderr: "some other error",
        }),
      ).toBe(false);
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

describe("falling back when a harness answers with silence", () => {
  /**
   * The failure this covers, from a real run: the router sent a task to
   * `pi` with a local ollama model that never loaded. pi printed its
   * session header and then nothing at all — no event, no error, no exit.
   * Every remaining iteration would have gone to the same stuck binary.
   */
  const silent = (name: string): Harness =>
    createMockHarness({
      name,
      execute: async () => ({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: `${name} produced no output for 120s and was stopped.`,
        output: "",
        filesChanged: [],
        duration: 120000,
        silent: true,
      }),
    });

  const answers = (name: string, calls: string[]): Harness =>
    createMockHarness({
      name,
      execute: async () => {
        calls.push(name);
        return {
          success: true,
          exitCode: 0,
          stdout: "done",
          stderr: "",
          output: "done",
          filesChanged: ["a.ts"],
          duration: 10,
        };
      },
    });

  const config = () => {
    const base = createDefaultConfig();
    // Both must be enabled for the router to consider them available.
    base.harnesses.opencode.enabled = true;
    base.harnesses["claude-code"].enabled = true;
    // The LLM routing layer runs its dispatch prompt *through a harness*,
    // so leaving it on would count routing calls as task attempts and make
    // which harness is chosen depend on a live model. The cascade below it
    // is deterministic, which is what these assertions are about.
    base.routing.llm.enabled = false;
    return base;
  };

  it("hands the task to another harness instead of asking the silent one again", async () => {
    const calls: string[] = [];
    const harnesses = new Map<string, Harness>([
      ["pi", silent("pi")],
      ["opencode", answers("opencode", calls)],
    ]);
    const cfg = config();
    cfg.harnesses.pi.enabled = true;

    const engine = new LoopEngine(cfg, harnesses);
    engine.start("add a project to the portfolio");
    const state = await engine.run(async () => {}, undefined, undefined, null, {
      harness: "pi",
      model: "ollama/qwen2.5-coder:7b",
    });

    expect(calls).toEqual(["opencode"]);
    expect(state.success).toBe(true);
  });

  it("does not carry the dead harness's model over to the next one", async () => {
    // A model id is written in its own CLI's notation. Passing pi's
    // `ollama/…` id to the harness that takes over would swap a silent run
    // for an immediate flag error.
    let seenModel: string | undefined = "unset";
    const harnesses = new Map<string, Harness>([
      ["pi", silent("pi")],
      [
        "opencode",
        createMockHarness({
          name: "opencode",
          execute: async (_prompt, options) => {
            seenModel = options?.model;
            return {
              success: true,
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: "ok",
              duration: 10,
            };
          },
        }),
      ],
    ]);
    const cfg = config();
    cfg.harnesses.pi.enabled = true;

    const engine = new LoopEngine(cfg, harnesses);
    engine.start("add a project to the portfolio");
    await engine.run(async () => {}, undefined, undefined, null, {
      harness: "pi",
      model: "ollama/qwen2.5-coder:7b",
    });

    expect(seenModel).not.toBe("ollama/qwen2.5-coder:7b");
  });

  it("stops once every harness has gone silent rather than burning iterations", async () => {
    let runs = 0;
    const counted = (name: string): Harness =>
      createMockHarness({
        name,
        execute: async () => {
          runs++;
          return {
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: "",
            output: "",
            duration: 1,
            silent: true,
          };
        },
      });

    const cfg = config();
    const engine = new LoopEngine(
      cfg,
      new Map<string, Harness>([
        ["opencode", counted("opencode")],
        ["claude-code", counted("claude-code")],
      ]),
    );
    engine.start("add a project to the portfolio");
    const state = await engine.run(async () => {});

    // Two harnesses, two attempts — not maxIterations attempts.
    expect(runs).toBe(2);
    expect(state.success).toBe(false);
    expect(state.error).toMatch(/respond|output/i);
  });

  it("leaves the prompt alone when it switches", async () => {
    // The next harness gets the original request, not a request with a note
    // about somebody else's failure stapled to it.
    let seenPrompt = "";
    const cfg = config();
    cfg.harnesses.pi.enabled = true;
    const engine = new LoopEngine(
      cfg,
      new Map<string, Harness>([
        ["pi", silent("pi")],
        [
          "opencode",
          createMockHarness({
            name: "opencode",
            execute: async (prompt) => {
              seenPrompt = prompt;
              return {
                success: true,
                exitCode: 0,
                stdout: "",
                stderr: "",
                output: "ok",
                duration: 1,
              };
            },
          }),
        ],
      ]),
    );
    engine.start("add a project to the portfolio");
    await engine.run(async () => {}, undefined, undefined, null, {
      harness: "pi",
    });

    expect(seenPrompt).toContain("add a project to the portfolio");
    expect(seenPrompt).not.toMatch(/previous attempt failed/i);
  });

  it("respects loop.harnessFallback: false", async () => {
    const cfg = config();
    cfg.harnesses.pi.enabled = true;
    cfg.loop.harnessFallback = false;
    const calls: string[] = [];
    const engine = new LoopEngine(
      cfg,
      new Map<string, Harness>([
        ["pi", silent("pi")],
        ["opencode", answers("opencode", calls)],
      ]),
    );
    engine.start("add a project to the portfolio");
    await engine.run(async () => {}, undefined, undefined, null, {
      harness: "pi",
    });

    expect(calls).toEqual([]);
  });
});
