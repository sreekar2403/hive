import { LoopState } from "@hive/shared";
import { Harness, HarnessEvent } from "@hive/shared/harness";
import type { HarnessAttachment } from "@hive/shared/harness";
import { Config } from "./config";
import { Router, type RoutingResult } from "./router";
import type { SoulRoutingGuidance } from "./secondBrain/starterSoul";
import type { RoutingHint } from "./secondBrain/types";
import { endSpan, log, recordSpan, startSpan } from "./telemetry";

export type LoopCallback = (
  iteration: number,
  output: string,
  success: boolean,
  filesChanged?: string[],
) => Promise<void>;

/**
 * Ceilings on what a retry carries forward. Windows caps a command line at
 * roughly 32k and the prompt is one argument of it, so this is a real limit
 * rather than a stylistic one.
 */
const MAX_RETRY_PROMPT_CHARS = 12000;
const MAX_RETRY_ERROR_CHARS = 4000;

/** Keeps the head — that is the instruction; the tail is what repeats. */
function clamp(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[…truncated]`;
}

export class LoopEngine {
  private state: LoopState;
  private config: Config;
  private harnesses: Map<string, Harness>;
  private router: Router;
  /**
   * Second Brain context for the current run, prepended to the prompt the
   * harness receives but deliberately kept *out* of `state.currentPrompt`.
   *
   * That separation is load-bearing. Routing and the retry prompt are both
   * derived from `currentPrompt`; if the briefing lived there, a lesson that
   * happened to mention "tests" would re-route the task, and each retry would
   * stack another copy of the briefing onto the prompt.
   */
  private preamble = "";
  /** Learned routing advice for this run, passed through to the Router. */
  private hints: RoutingHint[] = [];
  /** The user's stated routing preferences from soul.md, for this run. */
  private soul: SoulRoutingGuidance | undefined;
  /** Conversation history for context, prepended to the initial prompt. */
  private conversationHistory: Array<{ role: string; content: string }> = [];

  constructor(
    config: Config,
    harnesses: Map<string, Harness>,
    router?: Router,
  ) {
    this.config = config;
    this.harnesses = harnesses;
    this.router = router || new Router(config, harnesses);
    this.state = {
      iteration: 0,
      maxIterations: config.loop.maxIterations,
      currentPrompt: "",
      previousOutput: null,
      success: false,
      error: null,
    };
  }

  start(
    initialPrompt: string,
    conversationHistory?: Array<{ role: string; content: string }>,
  ): LoopState {
    this.conversationHistory = conversationHistory ?? [];
    this.state = {
      ...this.state,
      currentPrompt: initialPrompt,
      iteration: 0,
      success: false,
      error: null,
      previousOutput: null,
    };
    return this.state;
  }

  /**
   * `taskId` and `parentSpan` are optional so the engine stays usable (and
   * unit-testable) without a telemetry context; when they're supplied each
   * iteration and harness spawn is recorded as a span.
   *
   * `options.cwd` is the working tree the harness should run in — without
   * it every task runs against whichever directory the server was started
   * from, so a project's files never change. `options.harness` pins the
   * harness for the whole run rather than re-routing on each retry.
   */
  async run(
    onIteration: LoopCallback,
    taskId?: string,
    parentSpan?: string,
    projectId?: string | null,
    options?: {
      cwd?: string;
      harness?: string;
      /** Model in the CLI's own notation; see models/catalog.ts. */
      model?: string;
      agent?: string;
      /** Forwarded live, so the UI can show work as it happens. */
      onEvent?: (event: HarnessEvent) => void;
      /** Second Brain briefing, prepended to every iteration's prompt. */
      preamble?: string;
      /** Learned routing advice; advisory, see Router.applyHints. */
      hints?: RoutingHint[];
      /**
       * soul.md's routing section. Passed on every iteration because the
       * engine re-routes on retry, and a run that ignored the user's stated
       * preference on attempt two would be worse than one that never read it.
       */
      soul?: SoulRoutingGuidance;
      /** Conversation history for context. */
      conversationHistory?: Array<{ role: string; content: string }>;
      /** Files the person attached, forwarded to the CLI as it prefers. */
      attachments?: HarnessAttachment[];
      /**
       * Cancels the run. Forwarded to the harness so the child process is
       * killed, and checked between iterations so a cancelled run never
       * starts another one. The runtime permission guard uses this to stop
       * an agent that reached for a destructive command.
       */
      signal?: AbortSignal;
    },
  ): Promise<LoopState> {
    const traced = Boolean(taskId);
    this.preamble = options?.preamble ?? "";
    this.hints = options?.hints ?? [];
    this.soul = options?.soul;

    this.start(this.state.currentPrompt, options?.conversationHistory);

    while (this.state.iteration < this.state.maxIterations) {
      if (options?.signal?.aborted) break;
      this.state.iteration++;

      // Build prompt with context
      const prompt = this.buildPrompt();

      // Route to harness
      const decision = await this.route(options?.harness);
      const harness = this.harnesses.get(decision.harness);

      const iterationSpan =
        traced && taskId
          ? startSpan(
              taskId,
              `Iteration ${this.state.iteration}`,
              "iteration",
              parentSpan ?? null,
              { harness: decision.harness },
            )
          : null;

      if (!harness) {
        this.state.error = `Harness '${decision.harness}' not available`;
        if (taskId) {
          log("error", "loop", this.state.error, { taskId, projectId });
        }
        if (iterationSpan) endSpan(iterationSpan, "failed");
        break;
      }

      // Execute
      const spawnStart = Date.now();
      // A model pinned by the caller (the Chat composer's picker) wins; the
      // router's choice is used when there is none. Without this second half
      // the router could choose a model across providers and then never get
      // to run it — every task would fall back to the harness default.
      const result = await harness.execute(prompt, {
        cwd: options?.cwd ?? process.cwd(),
        model: options?.model || decision.model,
        agent: options?.agent || decision.agent,
        onEvent: options?.onEvent,
        signal: options?.signal,
        attachments: options?.attachments,
        // `loop.timeoutMs` was config nobody passed on, so a CLI that
        // stopped making progress ran until a person noticed. Per
        // iteration, not per task: each attempt gets the full budget,
        // which is what "how long may one harness run take" means.
        timeout: this.config.loop.timeoutMs,
      });
      if (traced && taskId) {
        recordSpan(
          taskId,
          `${decision.harness} run`,
          "harness",
          iterationSpan,
          spawnStart,
          result.success ? "ok" : "failed",
          {
            exitCode: result.exitCode,
            durationMs: result.duration,
            filesChanged: result.filesChanged,
            stderr: result.stderr ? result.stderr.slice(0, 600) : undefined,
          },
        );
        for (const toolCall of (result.events ?? []).filter(
          (e) => e.type === "tool",
        )) {
          recordSpan(
            taskId,
            toolCall.tool ?? "tool",
            "tool",
            iterationSpan,
            toolCall.at,
            "ok",
            { detail: toolCall.detail },
          );
        }
        if (result.filesChanged?.length) {
          recordSpan(
            taskId,
            `${result.filesChanged.length} file(s) changed`,
            "git",
            iterationSpan,
            spawnStart,
            "ok",
            { files: result.filesChanged.slice(0, 50) },
          );
        }
        log(
          result.success ? "info" : "warn",
          decision.harness,
          result.success
            ? `Finished in ${result.duration}ms`
            : `Exited with code ${result.exitCode}`,
          {
            taskId,
            projectId,
            context: { stderr: result.stderr?.slice(0, 400) },
          },
        );
      }

      // Notify callback
      await onIteration(
        this.state.iteration,
        result.output,
        result.success,
        result.filesChanged,
      );

      // A run that ran out of time is a failure, and a retryable one: the
      // next attempt may be the one that finishes. It must not fall into
      // the cancellation branch below, which stops the loop outright.
      if (result.timedOut) {
        this.state.previousOutput = result.output;
        this.state.error = result.stderr || "The harness ran out of time";
        if (iterationSpan) endSpan(iterationSpan, "failed", { timedOut: true });
        if (this.state.iteration >= this.state.maxIterations) break;
        this.state.currentPrompt = this.buildRetryPrompt(result);
        continue;
      }

      // A cancelled run is not a failure to retry — somebody stopped it on
      // purpose. Report why and leave the loop.
      if (result.aborted) {
        this.state.previousOutput = result.output;
        this.state.error = "Run cancelled";
        if (iterationSpan) endSpan(iterationSpan, "failed", { aborted: true });
        break;
      }

      // Check if we're done
      if (result.success) {
        this.state.success = true;
        this.state.currentPrompt = "";
        if (iterationSpan) endSpan(iterationSpan, "ok");
        break;
      }

      // Update state for next iteration
      this.state.previousOutput = result.output;
      this.state.error = result.stderr || "Execution failed";

      // Check retry threshold
      const willRetry = this.shouldRetry(result);
      if (iterationSpan) {
        endSpan(iterationSpan, "failed", { willRetry });
      }
      if (willRetry) {
        this.state.currentPrompt = this.buildRetryPrompt(result);
      } else {
        // Need human intervention
        if (taskId) {
          log("warn", "loop", "Stopping: the error isn't one we retry on", {
            taskId,
          });
        }
        break;
      }
    }

    return this.state;
  }

  private buildPrompt(): string {
    const parts: string[] = [];
    if (this.preamble) parts.push(this.preamble);

    // Include conversation history for context (only on first iteration).
    // Fences use "===": with no preamble this block leads the prompt, and
    // the prompt is a positional CLI argument — a leading "---" would be
    // parsed as an unknown option, killing the run before it starts.
    if (this.state.iteration === 1 && this.conversationHistory.length > 0) {
      parts.push("=== Conversation history ===");
      for (const msg of this.conversationHistory.slice(-8)) {
        parts.push(`${msg.role}: ${msg.content}`);
      }
      parts.push("=== End conversation history ===");
    }

    parts.push(this.state.currentPrompt);

    if (this.state.previousOutput) {
      parts.push("\n--- Previous attempt output ---");
      parts.push(this.state.previousOutput);
    }

    if (this.state.iteration > 1) {
      parts.push(
        `\n(Iteration ${this.state.iteration} of ${this.state.maxIterations})`,
      );
    }

    return parts.join("\n");
  }

  private async route(pinned?: string): Promise<RoutingResult> {
    if (pinned && this.harnesses.has(pinned)) {
      return {
        harness: pinned,
        model: "",
        reasoning: "Harness pinned for this run",
      };
    }
    return this.router.route(this.state.currentPrompt, {
      hints: this.hints,
      soul: this.soul,
    });
  }

  /** Retry only on errors that look transient.
   *
   *  This used to bail out when `permission.enabled` was false, which tied
   *  retry-on-transient-error to an unrelated feature: turning off the
   *  approval gate silently disabled retries for timeouts and refused
   *  connections too. The two have nothing to do with each other. */
  private shouldRetry(result: { success: boolean; stderr: string }): boolean {
    if (result.success) return true;

    const retryableErrors = [
      "syntax error",
      "permission denied",
      "not found",
      "timeout",
      "connection refused",
    ];

    return retryableErrors.some((err) =>
      result.stderr.toLowerCase().includes(err),
    );
  }

  /**
   * The next attempt's prompt: the original, plus why the last one failed.
   *
   * Both halves are bounded, and that is not tidiness. Each retry appends
   * the previous error to a prompt that already contains the one before
   * it, so an error that quotes the prompt back — `File not found: <the
   * entire prompt>` is a real one — doubles the prompt every attempt. By
   * the sixth the run died with a spawn ENAMETOOLONG naming nothing
   * useful, because Windows caps a command line at ~32k and the prompt is
   * passed as a single argument.
   */
  private buildRetryPrompt(result: { stderr: string; output: string }): string {
    const error = clamp(
      result.stderr || result.output || "Unknown error",
      MAX_RETRY_ERROR_CHARS,
    );
    const base = clamp(this.state.currentPrompt, MAX_RETRY_PROMPT_CHARS);
    return `${base}\n\nThe previous attempt failed with the following error:\n\`\`\`\n${error}\n\`\`\`\n\nPlease try a different approach.`;
  }

  getState(): LoopState {
    return { ...this.state };
  }

  cancel(): void {
    this.state.currentPrompt = "";
    this.state.success = false;
  }
}
