import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { LineTextParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";

/**
 * The CLIs that have no structured output mode.
 *
 * opencode, Claude Code, Codex, Gemini and Cursor all offer a JSON event
 * stream; aider, Amp, goose, Crush and GitHub Copilot CLI do not. What they
 * do offer is a one-shot, non-interactive flag and readable stdout, which is
 * enough to run them honestly — the trade is that their activity trail is
 * lines of text rather than typed tool calls, and no token counts come back.
 *
 * They share everything except three facts, so those are all a subclass
 * declares: what the binary is called, how it is told to run one prompt and
 * exit, and how it is told which model to use.
 */
export abstract class TextCliHarness implements Harness {
  abstract name: string;
  protected path: string;
  protected model: string;

  constructor(path: string, model = "") {
    this.path = path;
    this.model = model;
  }

  /** Args that precede the prompt, given the resolved model (may be ""). */
  protected abstract argsFor(model: string): string[];

  /**
   * How the prompt itself is passed. Most take it as a trailing positional;
   * the ones that take it as a flag value override this.
   */
  protected promptArgs(prompt: string): string[] {
    return [prompt];
  }

  isAvailable(): Promise<boolean> {
    return probeAvailable(this.path);
  }

  execute(
    prompt: string,
    options?: HarnessOptions,
  ): Promise<HarnessExecutionResult> {
    const model = options?.model || this.model;

    return runHarness({
      command: this.path,
      args: [...this.argsFor(model), ...this.promptArgs(prompt)],
      options,
      parser: new LineTextParser(),
    });
  }

  /**
   * These CLIs resolve model names themselves (LiteLLM ids, account plans,
   * per-profile config), so there is nothing here to usefully reject — the
   * CLI gives a better error than a guess would.
   */
  isCompatible(): boolean {
    return true;
  }
}

/**
 * aider — the pair-programming CLI. `--message` runs one instruction and
 * exits; `--yes-always` stops it prompting for confirmations it will never
 * receive here, and `--no-pretty` turns off the ANSI redraw that would
 * otherwise reach the activity trail as cursor noise.
 *
 * aider commits by itself unless told not to. `--no-auto-commits` keeps that
 * decision with Hive, whose branch/worktree handling in branches.ts expects
 * to own the commit boundary.
 */
export class AiderHarness extends TextCliHarness {
  name = "aider";

  constructor(path = "aider", model = "") {
    super(path, model);
  }

  protected argsFor(model: string): string[] {
    const args = ["--no-pretty", "--yes-always", "--no-auto-commits"];
    if (model) args.push("--model", model);
    return args;
  }

  protected promptArgs(prompt: string): string[] {
    return ["--message", prompt];
  }
}

/**
 * Amp (Sourcegraph). `-x` is execute-and-exit. Amp chooses its own model
 * per step and exposes no model flag, so a pinned model is ignored rather
 * than passed — better to run than to fail on a flag that does not exist.
 */
export class AmpHarness extends TextCliHarness {
  name = "amp";

  constructor(path = "amp", model = "") {
    super(path, model);
  }

  protected argsFor(): string[] {
    return ["-x"];
  }
}

/**
 * goose (Block). `goose run -t <text>` runs one instruction headlessly.
 * The model is configured per goose profile rather than per invocation, so
 * as with Amp a pinned model is not forced onto the command line.
 */
export class GooseHarness extends TextCliHarness {
  name = "goose";

  constructor(path = "goose", model = "") {
    super(path, model);
  }

  protected argsFor(): string[] {
    return ["run"];
  }

  protected promptArgs(prompt: string): string[] {
    return ["-t", prompt];
  }
}

/**
 * Crush (Charm). `crush run` is its non-interactive mode; `-q` drops the
 * spinner so stdout is just the answer.
 */
export class CrushHarness extends TextCliHarness {
  name = "crush";

  constructor(path = "crush", model = "") {
    super(path, model);
  }

  protected argsFor(): string[] {
    return ["run", "-q"];
  }
}

/**
 * GitHub Copilot CLI. `-p` is its non-interactive prompt flag and
 * `--allow-all-tools` is required for a headless run to do anything at all —
 * without it every tool call stops for an approval nobody is there to give.
 *
 * That flag is the reason this harness is the one most worth pointing at a
 * worktree rather than your main checkout; `createParallelBranches` already
 * does exactly that for parallel tasks.
 */
export class CopilotHarness extends TextCliHarness {
  name = "copilot";

  constructor(path = "copilot", model = "") {
    super(path, model);
  }

  protected argsFor(model: string): string[] {
    const args = ["--allow-all-tools"];
    if (model) args.push("--model", model);
    return args;
  }

  protected promptArgs(prompt: string): string[] {
    return ["-p", prompt];
  }
}
