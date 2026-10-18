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
   *
   * Two contracts are pinned here, from the other real run: an *unpinned*
   * task falls back to another harness, but a task the caller *pinned*
   * (the composer's harness/model picker) must fail rather than silently
   * switch providers — that switch replaced a silent local run with
   * claude-sonnet-4 and an expired OAuth.
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

  it("hands an unpinned task to another harness instead of asking the silent one again", async () => {
    const calls: string[] = [];
    const harnesses = new Map<string, Harness>([
      ["opencode", silent("opencode")],
      ["claude-code", answers("claude-code", calls)],
    ]);
    const cfg = config();

    const engine = new LoopEngine(cfg, harnesses);
    engine.start("add a project to the portfolio");
    const state = await engine.run(async () => {});

    expect(calls).toEqual(["claude-code"]);
    expect(state.success).toBe(true);
  });

  it("fails a pinned task when the pin goes silent instead of switching harnesses", async () => {
    // The regression from the real run: opencode was pinned with a local
    // lmstudio model, went silent, and the loop handed the task to
    // claude-code — which ran claude-sonnet-4 against expired OAuth. A pin
    // is the caller's explicit choice; switching providers behind it is
    // worse than failing.
    const calls: string[] = [];
    const harnesses = new Map<string, Harness>([
      ["opencode", silent("opencode")],
      ["claude-code", answers("claude-code", calls)],
    ]);
    const cfg = config();

    const engine = new LoopEngine(cfg, harnesses);
    engine.start("add a project to the portfolio");
    const state = await engine.run(async () => {}, undefined, undefined, null, {
      harness: "opencode",
      model: "lmstudio/qwen3.5-4b",
    });

    expect(calls).toEqual([]);
    expect(state.success).toBe(false);
    expect(state.error).toMatch(/pinned|no output/i);
  });

  it("never runs a pinned harness the user has disabled", async () => {
    // `harnesses.has()` proves the CLI is installed, not that the user
    // wants it. A pin must not resurrect a harness turned off in Settings.
    const calls: string[] = [];
    const cfg = config();
    cfg.harnesses["claude-code"].enabled = false;

    const engine = new LoopEngine(
      cfg,
      new Map<string, Harness>([
        ["claude-code", answers("claude-code", calls)],
        ["opencode", answers("opencode", calls)],
      ]),
    );
    engine.start("fix the failing test");
    await engine.run(async () => {}, undefined, undefined, null, {
      harness: "claude-code",
    });

    expect(calls).toEqual(["opencode"]);
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
    const engine = new LoopEngine(
      cfg,
      new Map<string, Harness>([
        ["opencode", silent("opencode")],
        [
          "claude-code",
          createMockHarness({
            name: "claude-code",
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
    await engine.run(async () => {});

    expect(seenPrompt).toContain("add a project to the portfolio");
    expect(seenPrompt).not.toMatch(/previous attempt failed/i);
  });

  it("respects loop.harnessFallback: false", async () => {
    const cfg = config();
    cfg.loop.harnessFallback = false;
    const calls: string[] = [];
    const engine = new LoopEngine(
      cfg,
      new Map<string, Harness>([
        ["opencode", silent("opencode")],
        ["claude-code", answers("claude-code", calls)],
      ]),
    );
    engine.start("add a project to the portfolio");
    await engine.run(async () => {});

    expect(calls).toEqual([]);
  });

  describe("native session resume", () => {
    const resumable = (
      name: string,
      seen: Array<string | undefined>,
      sessionId?: string,
    ): Harness =>
      createMockHarness({
        name,
        supportsResume: () => true,
        execute: async (_prompt, options) => {
          seen.push(options?.resumeSessionId);
          return {
            success: true,
            exitCode: 0,
            stdout: "done",
            stderr: "",
            output: "done",
            filesChanged: [],
            duration: 10,
            sessionId,
          };
        },
      });

    const resumeConfig = () => {
      const base = createDefaultConfig();
      base.harnesses.opencode.enabled = true;
      base.harnesses["claude-code"].enabled = true;
      base.routing.llm.enabled = false;
      return base;
    };

    it("passes the native session id when the harness matches", async () => {
      const seen: Array<string | undefined> = [];
      const engine = new LoopEngine(
        resumeConfig(),
        new Map<string, Harness>([["opencode", resumable("opencode", seen)]]),
      );
      engine.start("follow up on the same work");
      await engine.run(async () => {}, undefined, undefined, null, {
        harness: "opencode",
        resume: { harness: "opencode", sessionId: "native-1" },
      });

      expect(seen).toEqual(["native-1"]);
    });

    it("runs fresh when the harness switched", async () => {
      const seen: Array<string | undefined> = [];
      const engine = new LoopEngine(
        resumeConfig(),
        new Map<string, Harness>([["opencode", resumable("opencode", seen)]]),
      );
      engine.start("same chat, different harness now");
      await engine.run(async () => {}, undefined, undefined, null, {
        harness: "opencode",
        resume: { harness: "codex", sessionId: "native-9" },
      });

      expect(seen).toEqual([undefined]);
    });

    it("runs fresh when the adapter has no resume mechanism", async () => {
      const seen: Array<string | undefined> = [];
      const plain = createMockHarness({
        name: "opencode",
        execute: async (_prompt, options) => {
          seen.push(options?.resumeSessionId);
          return {
            success: true,
            exitCode: 0,
            stdout: "done",
            stderr: "",
            output: "done",
            filesChanged: [],
            duration: 10,
          };
        },
      });
      const engine = new LoopEngine(
        resumeConfig(),
        new Map<string, Harness>([["opencode", plain]]),
      );
      engine.start("adapter cannot resume");
      await engine.run(async () => {}, undefined, undefined, null, {
        harness: "opencode",
        resume: { harness: "opencode", sessionId: "native-1" },
      });

      expect(seen).toEqual([undefined]);
    });

    it("records the native session and its harness on the loop state", async () => {
      const engine = new LoopEngine(
        resumeConfig(),
        new Map<string, Harness>([
          ["opencode", resumable("opencode", [], "ses_live_1")],
        ]),
      );
      engine.start("first turn");
      const state = await engine.run(async () => {}, undefined, undefined, null, {
        harness: "opencode",
      });

      expect(state.sessionId).toBe("ses_live_1");
      expect(state.sessionHarness).toBe("opencode");
    });

    it("omits the history block when natively resuming", async () => {
      let seenPrompt = "";
      const engine = new LoopEngine(
        resumeConfig(),
        new Map<string, Harness>([
          [
            "opencode",
            createMockHarness({
              name: "opencode",
              supportsResume: () => true,
              execute: async (prompt) => {
                seenPrompt = prompt;
                return {
                  success: true,
                  exitCode: 0,
                  stdout: "",
                  stderr: "",
                  output: "done",
                  filesChanged: [],
                  duration: 10,
                };
              },
            }),
          ],
        ]),
      );
      const history = [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
      ];
      engine.start("do the follow-up");
      await engine.run(async () => {}, undefined, undefined, null, {
        harness: "opencode",
        conversationHistory: history,
        resume: { harness: "opencode", sessionId: "native-1" },
      });

      // The native session already holds the conversation — resending it
      // as text would double-pay tokens for zero new context.
      expect(seenPrompt).toContain("do the follow-up");
      expect(seenPrompt).not.toContain("Conversation history");
      expect(seenPrompt).not.toContain("earlier question");
    });

    it("keeps the history block on fresh runs", async () => {
      let seenPrompt = "";
      const engine = new LoopEngine(
        resumeConfig(),
        new Map<string, Harness>([
          [
            "opencode",
            createMockHarness({
              name: "opencode",
              supportsResume: () => true,
              execute: async (prompt) => {
                seenPrompt = prompt;
                return {
                  success: true,
                  exitCode: 0,
                  stdout: "",
                  stderr: "",
                  output: "done",
                  filesChanged: [],
                  duration: 10,
                };
              },
            }),
          ],
        ]),
      );
      const history = [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
      ];
      engine.start("same chat, different harness now");
      await engine.run(async () => {}, undefined, undefined, null, {
        harness: "opencode",
        conversationHistory: history,
        resume: { harness: "codex", sessionId: "native-9" },
      });

      expect(seenPrompt).toContain("Conversation history");
      expect(seenPrompt).toContain("earlier question");
    });
  });
});
