import { LoopState, RoutingDecision } from "@hive/shared";
import { Harness, HarnessEvent } from "@hive/shared/harness";
import { Config } from "./config";
import { Router } from "./router";
import type { RoutingHint } from "./secondBrain/types";
import { endSpan, log, recordSpan, startSpan } from "./telemetry";

export type LoopCallback = (
  iteration: number,
  output: string,
  success: boolean,
  filesChanged?: string[],
) => Promise<void>;

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

  constructor(config: Config, harnesses: Map<string, Harness>, router?: Router) {
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

  start(initialPrompt: string): LoopState {
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
    },
  ): Promise<LoopState> {
    const traced = Boolean(taskId);
    this.preamble = options?.preamble ?? "";
    this.hints = options?.hints ?? [];

    while (this.state.iteration < this.state.maxIterations) {
      this.state.iteration++;

      // Build prompt with context
      const prompt = this.buildPrompt();

      // Route to harness
      const decision = this.route(options?.harness);
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
      const result = await harness.execute(prompt, {
        cwd: options?.cwd ?? process.cwd(),
        model: options?.model,
        agent: options?.agent,
        onEvent: options?.onEvent,
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
          { taskId, projectId, context: { stderr: result.stderr?.slice(0, 400) } },
        );
      }

      // Notify callback
      await onIteration(
        this.state.iteration,
        result.output,
        result.success,
        result.filesChanged,
      );

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

  private route(pinned?: string): RoutingDecision {
    if (pinned && this.harnesses.has(pinned)) {
      return {
        harness: pinned,
        model: "",
        reasoning: "Harness pinned for this run",
      };
    }
    return this.router.route(this.state.currentPrompt, { hints: this.hints });
  }

  private shouldRetry(result: { success: boolean; stderr: string }): boolean {
    if (result.success) return true;
    if (!this.config.permission.enabled) return false;

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

  private buildRetryPrompt(result: { stderr: string; output: string }): string {
    const error = result.stderr || result.output || "Unknown error";
    return `${this.state.currentPrompt}\n\nThe previous attempt failed with the following error:\n\`\`\`\n${error}\n\`\`\`\n\nPlease try a different approach.`;
  }

  getState(): LoopState {
    return { ...this.state };
  }

  cancel(): void {
    this.state.currentPrompt = "";
    this.state.success = false;
  }
}
