import spawn from "cross-spawn";
import type {
  HarnessEvent,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { detectFilesChanged } from "../gitUtils";
import { stripAnsi } from "../textUtils";
import type { StreamParser } from "./eventStream";

/**
 * The part of running a CLI harness that is the same for all of them:
 * spawn it, decode its event stream as it arrives, forward each event to
 * whoever is watching, and assemble a readable answer at the end.
 *
 * Events are forwarded *as they happen* rather than after the process
 * exits — that live trail is what the chat window shows while a task is
 * still running.
 */
export interface RunSpec {
  command: string;
  args: string[];
  options?: HarnessOptions;
  parser: StreamParser;
}

export function runHarness(spec: RunSpec): Promise<HarnessExecutionResult> {
  const { command, args, options, parser } = spec;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const cwd = options?.cwd || process.cwd();
    const collected: HarnessEvent[] = [];
    let stdout = "";
    let stderr = "";

    const emit = (events: HarnessEvent[]) => {
      for (const e of events) {
        collected.push(e);
        try {
          options?.onEvent?.(e);
        } catch {
          // A broken listener must not take the run down with it.
        }
      }
    };

    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // These CLIs wait on stdin when they think a session is interactive.
    proc.stdin?.end();

    proc.stdout?.on("data", (data: Buffer) => {
      const text = stripAnsi(data.toString());
      stdout += text;
      emit(parser.push(text));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      emit(parser.finish());

      const cleanStdout = stripAnsi(stdout);
      const cleanStderr = stripAnsi(stderr);
      const parsed = parser.finalText();

      resolve({
        success: code === 0,
        exitCode: code ?? 1,
        stdout: cleanStdout,
        stderr: cleanStderr,
        // Parsed text first: the raw stream is a JSON envelope, and that
        // envelope reaching the chat window was a long-standing bug.
        output: parsed || cleanStderr || cleanStdout,
        filesChanged: detectFilesChanged(cwd),
        duration: Date.now() - startTime,
        events: collected,
        usage: parser.usage(),
      });
    });

    proc.on("error", (err) => reject(err));
  });
}

/** `<path> --version` succeeded. */
export function probeAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, ["--version"], { timeout: 3000 });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}
