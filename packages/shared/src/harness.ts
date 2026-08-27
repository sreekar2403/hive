/**
 * What a harness reports while it works, normalised across CLIs.
 *
 * Each CLI speaks its own event dialect (opencode's `--format json`,
 * Claude Code's `--output-format stream-json`, pi's `--mode json`); the
 * adapters in packages/server/src/harnesses translate into these so the
 * UI has one shape to render regardless of who is running.
 */
export type HarnessEventType =
  | "status"
  | "text"
  | "thinking"
  | "tool"
  | "tool-result"
  | "usage"
  | "error";

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
  /** Called as the run happens, so the UI can show work in progress. */
  onEvent?: (event: HarnessEvent) => void;
  /**
   * Cancels the run. The child process is killed and the result comes back
   * with `aborted: true`. This is what lets a watcher stop a harness the
   * moment it does something it shouldn't — see the runtime permission
   * guard in packages/server/src/runtimeGuard.ts.
   */
  signal?: HarnessAbortSignal;
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
