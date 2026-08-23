import { LoopState, RoutingDecision } from "@hive/shared";
import { Harness } from "@hive/shared/harness";
import { Config } from "./config";
import { Router } from "./router";

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

  async run(onIteration: LoopCallback): Promise<LoopState> {
    while (this.state.iteration < this.state.maxIterations) {
      this.state.iteration++;

      // Build prompt with context
      const prompt = this.buildPrompt();

      // Route to harness
      const decision = this.route();
      const harness = this.harnesses.get(decision.harness);

      if (!harness) {
        this.state.error = `Harness '${decision.harness}' not available`;
        break;
      }

      // Execute
      const result = await harness.execute(prompt, {
        cwd: process.cwd(),
      });

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
        break;
      }

      // Update state for next iteration
      this.state.previousOutput = result.output;
      this.state.error = result.stderr || "Execution failed";

      // Check retry threshold
      if (this.shouldRetry(result)) {
        this.state.currentPrompt = this.buildRetryPrompt(result);
      } else {
        // Need human intervention
        break;
      }
    }

    return this.state;
  }

  private buildPrompt(): string {
    const parts: string[] = [this.state.currentPrompt];

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

  private route(): RoutingDecision {
    return this.router.route(this.state.currentPrompt);
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
