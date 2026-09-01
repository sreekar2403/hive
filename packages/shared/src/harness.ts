/**
 * What a harness reports while it works, normalised across CLIs.
 *
 * Each CLI speaks its own event dialect (opencode's `--format json`,
 * Claude Code's `--output-format stream-json`, pi's `--mode json`); the
 * adapters in packages/server/src/harnesses translate into these so the
 * UI has one shape to render regardless of who is running.
 */
export type HarnessEventType =
  "status" | "text" | "thinking" | "tool" | "tool-result" | "usage" | "error";

export interface HarnessUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface HarnessEvent {
  type: HarnessEventType;
  /** Message body for status/text/thinking/error events. */
  text?: string;
  /** Tool name, for tool and tool-result events. */
  tool?: string;
  /** Correlates a tool-result back to its tool call. */
  callId?: string;
  /** One-line summary of the tool's input or output — already truncated. */
  detail?: string;
  status?: "running" | "completed" | "failed";
  usage?: HarnessUsage;
  at: number;
}

/**
 * The part of `AbortSignal` a harness needs, declared structurally.
 *
 * This package compiles with `lib: ES2022` and no DOM or Node globals, so
 * the real `AbortSignal` type isn't in scope here. A genuine AbortSignal
 * satisfies this shape, which is all callers ever pass.
 */
export interface HarnessAbortSignal {
  readonly aborted: boolean;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface HarnessOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  /**
   * Model to run, in whatever form the CLI expects — `provider/model` for
   * opencode and pi, an alias or full id for Claude Code. Resolved from
   * the catalog (packages/server/src/models/catalog.ts).
   */
  model?: string;
  /** Agent/persona to run under, where the CLI supports one. */
  agent?: string;
  /**
   * How long the run may produce *nothing at all* before it is treated as a
   * dead CLI, in milliseconds. 0 disables the check.
   *
   * Separate from `timeout`, which bounds the whole run. A CLI that is
   * working prints something — a thinking token, a tool call, a status
   * line — every few seconds. One that has printed nothing for minutes is
   * not slow, it is stuck: a local model that never loaded, a provider
   * that accepted the request and went quiet, an interactive prompt nobody
   * can answer. Waiting out the full run budget for that wastes the whole
   * budget and tells the loop nothing it can act on, so silence is
   * detected early and reported as its own condition (`silent`) — which is
   * what lets LoopEngine give the work to a different provider instead of
   * asking the same stuck one again.
   */
  idleTimeout?: number;
  /** Called as the run happens, so the UI can show work in progress. */
  onEvent?: (event: HarnessEvent) => void;
  /**
   * Cancels the run. The child process is killed and the result comes back
   * with `aborted: true`. This is what lets a watcher stop a harness the
   * moment it does something it shouldn't — see the runtime permission
   * guard in packages/server/src/runtimeGuard.ts.
   */
  signal?: HarnessAbortSignal;
  /**
   * Files the person attached to their message — a screenshot of the bug, a
   * spec, a CSV, a design.
   *
   * Paths are absolute, and deliberately so: sub-agents run in their own
   * worktrees, so anything relative would resolve differently for each of
   * them, or not at all.
   *
   * Support is uneven and the adapters paper over it rather than refusing.
   * opencode takes `--file`, Codex takes `--image` for images only; the
   * rest have no flag at all but do have a file-reading tool, so their
   * adapter names the paths in the prompt instead. See attachmentPreamble()
   * in packages/server/src/harnesses/attachments.ts.
   */
  attachments?: HarnessAttachment[];
}

export interface HarnessAttachment {
  /** Absolute path on the machine running the harness. */
  path: string;
  /** Original filename, for telling the agent what it is looking at. */
  name: string;
  /** e.g. "image/png", "text/csv". Empty when it could not be determined. */
  mimeType: string;
}

export interface HarnessExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The readable answer — never a raw JSON envelope. */
  output: string;
  filesChanged?: string[];
  duration: number;
  /** Everything that happened, in order. */
  events?: HarnessEvent[];
  usage?: HarnessUsage;
  /** The run was cancelled through `options.signal`, not by the CLI itself. */
  aborted?: boolean;
  /**
   * The run hit `options.timeout` and was killed.
   *
   * Kept separate from `aborted`, which means a person or a guard stopped
   * this deliberately. A deadline is not that, and the loop needs to tell
   * them apart: one is a decision to respect, the other is a failure to
   * report and possibly retry.
   */
  timedOut?: boolean;
  /**
   * The CLI never answered: it either printed nothing for `idleTimeout`, or
   * it exited having produced no parseable event and no text.
   *
   * Distinct from `timedOut` (it ran, slowly, and the deadline caught it)
   * and from a plain non-zero exit (it ran and failed, and said why). A
   * silent harness has told us nothing about the task, so retrying it with
   * a better prompt is pointless — the answer is a different provider.
   */
  silent?: boolean;
}

export interface Harness {
  name: string;
  isAvailable(): Promise<boolean>;
  execute(
    prompt: string,
    options?: HarnessOptions,
  ): Promise<HarnessExecutionResult>;
  isCompatible(model: string): boolean;
}
