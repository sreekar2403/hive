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

      // Hard check for "the CLI changed its event stream": output arrived
      // but none of it parsed into events. Without this, a CLI update
      // silently empties the chat window's activity trail. The run itself
      // is not failed here — some CLIs legitimately print plain text —
      // but the mismatch is surfaced so it can be diagnosed.
      if (collected.length === 0 && cleanStdout.trim().length > 0) {
        const hint =
          `[harness] ${command} produced ${cleanStdout.length} chars of stdout ` +
          `but 0 parseable events — its output format may have changed. ` +
          `Falling back to raw text.`;
        console.warn(hint);
      }

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

/**
 * Opt-in deep check: runs a real prompt through a harness CLI and verifies
 * its event stream parses. Expensive (a real model call) and slow, so it
 * belongs behind an explicit user action — Settings' "Re-check", `hive
 * doctor --deep` — never on the boot path.
 *
 * `parser` may be null for CLIs without a structured stream; those are only
 * checked for a clean exit.
 */
export async function probeHarnessHealth(
  command: string,
  args: string[],
  parser: StreamParser | null,
  testPrompt = "Reply with exactly: ok",
  cwd = process.cwd(),
  timeoutMs = 30000,
): Promise<{ healthy: boolean; error?: string; eventsParsed: number }> {
  return new Promise((resolve) => {
    let eventsParsed = 0;
    let stderr = "";
    let settled = false;

    const finish = (result: {
      healthy: boolean;
      error?: string;
      eventsParsed: number;
    }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, [...args, testPrompt], {
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      finish({
        healthy: false,
        error: `Could not start ${command}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        eventsParsed: 0,
      });
      return;
    }

    // Kill the child on timeout — otherwise a hung CLI keeps running (and
    // possibly burning tokens) after the check has already given up.
    const timer = setTimeout(() => {
      proc.kill();
      finish({
        healthy: false,
        error: `${command} did not answer a one-word prompt within ${Math.round(
          timeoutMs / 1000,
        )}s`,
        eventsParsed,
      });
    }, timeoutMs);

    const countEvents = (events: HarnessEvent[] | undefined | null) => {
      if (!Array.isArray(events)) return;
      for (const e of events) {
        if (!e?.type || !e?.at) {
          clearTimeout(timer);
          finish({
            healthy: false,
            error: "Parser produced a malformed event (missing type or timestamp)",
            eventsParsed,
          });
          return;
        }
        eventsParsed++;
      }
    };

    proc.stdin?.end();

    proc.stdout?.on("data", (data: Buffer) => {
      const text = stripAnsi(data.toString());
      if (parser) countEvents(parser.push(text));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;

      if (parser) countEvents(parser.finish());

      if (code !== 0) {
        finish({
          healthy: false,
          error: `${command} exited with code ${code}: ${stderr.slice(0, 200)}`,
          eventsParsed,
        });
        return;
      }

      if (parser && eventsParsed === 0) {
        finish({
          healthy: false,
          error:
            `${command} ran but its output produced no parseable events — ` +
            `the CLI's output format may have changed`,
          eventsParsed: 0,
        });
        return;
      }

      finish({ healthy: true, eventsParsed });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      finish({
        healthy: false,
        error: `Failed to spawn ${command}: ${err.message}`,
        eventsParsed,
      });
    });
  });
}
