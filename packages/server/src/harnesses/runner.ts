import spawn from "cross-spawn";
import type {
  HarnessEvent,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { detectFilesChanged } from "../gitUtils";
import { stripAnsi } from "../textUtils";
import type { StreamParser } from "./eventStream";
import { resolveWindowsShim } from "./winShim";

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

  return new Promise((resolve) => {
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

    // On Windows the CLI is usually an npm `.cmd` shim, and running one
    // routes the arguments through cmd.exe, which cuts every argument at
    // its first newline. Prompts here are always multi-line. See winShim.ts.
    const exe = resolveWindowsShim(command);

    const proc = spawn(exe.command, [...exe.prefixArgs, ...args], {
      cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Cancellation. The child is killed and the close handler below reports
    // `aborted` so callers can tell "we stopped this" apart from "the CLI
    // failed". SIGTERM first; some of these CLIs spawn their own children
    // and ignore a polite signal, so escalate if it is still alive.
    let aborted = false;
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      try {
        proc.kill("SIGTERM");
        const escalate = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            // Already gone.
          }
        }, 2000);
        escalate.unref?.();
      } catch {
        // Already exited — nothing to stop.
      }
    };

    const signal = options?.signal;
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    // The run's own deadline.
    //
    // `HarnessOptions.timeout` was declared and never honoured, which made
    // `loop.timeoutMs` decorative: a CLI that stopped making progress ran
    // until somebody noticed. That is not hypothetical — an opencode run
    // waiting on a permission prompt it could never be answered sat for
    // forty minutes against a configured five-minute budget.
    //
    // Reported distinctly from a cancellation. "We stopped this on purpose"
    // and "this never finished" need different answers from the loop, and
    // conflating them would have a timeout look like a user pressing stop.
    let timedOut = false;
    const budget = options?.timeout ?? 0;
    const deadline =
      budget > 0
        ? setTimeout(() => {
            timedOut = true;
            onAbort();
          }, budget)
        : null;
    deadline?.unref?.();

    // The silence watchdog.
    //
    // The run deadline above only catches a CLI that is slow. It does not
    // catch one that is *stuck*, and the difference matters: a stuck CLI
    // burns the entire run budget before the loop learns anything, and then
    // the loop's only move is to ask the same stuck CLI again with a
    // slightly different prompt.
    //
    // The observed case: `pi --model ollama/<a model that never loads>`
    // prints its session header, `agent_start`, `turn_start` — and then
    // nothing, forever. Every one of these CLIs prints *something* every few
    // seconds while it is genuinely working, so a long gap with no byte on
    // either stream is a reliable signal that nobody is coming. Report it as
    // `silent` and let the caller take the work elsewhere.
    let wentSilent = false;
    let lastOutputAt = Date.now();
    const idleBudget = options?.idleTimeout ?? 0;
    const watchdog =
      idleBudget > 0
        ? setInterval(
            () => {
              if (Date.now() - lastOutputAt < idleBudget) return;
              wentSilent = true;
              onAbort();
            },
            Math.min(idleBudget, 5000),
          )
        : null;
    watchdog?.unref?.();

    // These CLIs wait on stdin when they think a session is interactive.
    proc.stdin?.end();

    proc.stdout?.on("data", (data: Buffer) => {
      lastOutputAt = Date.now();
      const text = stripAnsi(data.toString());
      stdout += text;
      emit(parser.push(text));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      lastOutputAt = Date.now();
      stderr += data.toString();
    });

    // 'error' and 'close' can both fire for the same failure (a missing
    // binary emits ENOENT and then closes), so settle exactly once.
    let settled = false;
    const settle = (result: HarnessExecutionResult) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      if (watchdog) clearInterval(watchdog);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    // 'close' is the good signal — it means the child exited *and* its stdio
    // pipes drained, so nothing the CLI wrote is lost. It is not a
    // guaranteed one: on Windows a killed shim can leave a grandchild
    // holding the write end of the pipe, in which case 'exit' fires and
    // 'close' never does, and the run would hang forever holding a slot in
    // ConcurrencyGate. 'exit' therefore arms a fallback below — but only
    // for the runs we killed, which is where that hang happens. A child
    // exiting on its own is always allowed to finish draining.
    const finish = (code: number | null) => {
      if (settled) return;
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

      // What the CLI said went wrong, lifted out of its event stream.
      //
      // Several of these report a failure as an `error` event on *stdout*
      // and exit non-zero with stderr empty — opencode answering a dead
      // model with an "Unexpected server error" event is the case that
      // prompted this. Left in the events alone, the message reached the
      // activity trail and nowhere else: the loop's retry check reads
      // stderr and the chat window reads output, and both were blank. The
      // run failed and said why, and nobody was listening.
      const errorText = collected
        .filter((e) => e.type === "error" && e.text)
        .map((e) => e.text as string)
        .join("\n");

      // Whether the CLI actually answered. An error event is it telling us
      // it could not, which is the opposite of an answer; a status line is
      // bookkeeping. Anything else — text, thinking, a tool call — means it
      // did work we can judge.
      const answered =
        parsed.trim().length > 0 ||
        collected.some((e) => e.type !== "error" && e.type !== "status");

      // A timeout has to say so. Left to speak for itself a killed child
      // reports an empty stream and a non-zero exit, which reads as "the
      // CLI failed for no reason" — the one diagnosis that sends whoever
      // is reading it looking in the wrong place.
      const timeoutNote = wentSilent
        ? `${command} produced no output for ${Math.round(idleBudget / 1000)}s and was stopped.`
        : timedOut
          ? `${command} did not finish within ${Math.round(budget / 1000)}s and was stopped.`
          : "";

      settle({
        success: code === 0 && !aborted,
        exitCode: code ?? 1,
        stdout: cleanStdout,
        stderr: [timeoutNote, errorText, cleanStderr]
          .filter(Boolean)
          .join("\n"),
        // Parsed text first: the raw stream is a JSON envelope, and that
        // envelope reaching the chat window was a long-standing bug.
        output:
          parsed || timeoutNote || errorText || cleanStderr || cleanStdout,
        filesChanged: detectFilesChanged(cwd),
        duration: Date.now() - startTime,
        events: collected,
        usage: parser.usage(),
        aborted: aborted && !timedOut && !wentSilent,
        timedOut,
        // Either the watchdog tripped, or the CLI came and went without
        // answering — it printed nothing, or all it printed was its own
        // error. Both mean the same thing to the caller: this harness has
        // not attempted the task, so try the work somewhere else.
        //
        // A clean exit is never silent, however quiet it was. A CLI that
        // exited 0 did the work; some of them say almost nothing while
        // doing it, and calling that a dead provider would throw away a
        // succeeded run and hand the task to somebody else to redo.
        silent: code === 0 ? false : wentSilent || (!aborted && !answered),
      });
    };

    proc.on("close", (code) => finish(code));

    // The kill-path fallback. Scoped to aborted runs on purpose: arming it
    // for every run would race a healthy child still draining a large
    // stream, and whatever arrived after the timer fired would be dropped
    // by `settled`. Here there is no such trade — the child is already
    // dead, and the alternative is hanging forever. Anything still in
    // flight after the grace period is lost, which for a killed CLI is the
    // tail of output we stopped it in the middle of.
    proc.on("exit", (code) => {
      if (!aborted) return;
      const grace = setTimeout(() => finish(code), 2000);
      grace.unref?.();
    });

    // A CLI that isn't installed is a normal condition here, not an
    // exception: startup probes twelve of them and a user can uninstall one
    // mid-session. Rejecting made that a thrown error every caller had to
    // guard — and LoopEngine calls execute() unguarded, so an uninstalled
    // CLI took down the whole run instead of failing one iteration. Report
    // it the same way any other failed run is reported.
    proc.on("error", (err) => {
      const message =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `${command} is not installed or not on PATH`
          : `${command} could not be started: ${err.message}`;

      settle({
        success: false,
        // 127 is the shell's own "command not found".
        exitCode: 127,
        stdout: "",
        stderr: message,
        output: message,
        filesChanged: [],
        duration: Date.now() - startTime,
        events: collected,
        usage: parser.usage(),
        aborted,
      });
    });
  });
}

/** `<path> --version` succeeded. */
export function probeAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const exe = resolveWindowsShim(command);
      const proc = spawn(exe.command, [...exe.prefixArgs, "--version"], {
        timeout: 3000,
        // stdin must be closed, not left as an open, silent pipe: a CLI
        // that can't tell it has no real TTY (GitHub Copilot CLI's shim
        // does this) reads stdin looking for input and blocks forever on
        // a pipe nobody ever writes to or closes. That hang is invisible
        // whenever this process's own stdin happens to be inherited from
        // a real console — which is most manual runs — and only shows up
        // when Hive itself is spawned with piped stdio, e.g. under
        // `hive mcp`. `timeout` above is a second line of defense; it
        // does not reliably kill a child that has grandchildren of its
        // own still holding the stdio pipes open.
        stdio: ["ignore", "ignore", "ignore"],
      });
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimeout);
        resolve(ok);
      };
      proc.on("error", () => done(false));
      proc.on("close", (code) => done(code === 0));
      // Belt and suspenders: if the child still hasn't closed shortly
      // after the spawn-level timeout should have killed it, force it and
      // stop waiting rather than hang this probe (and everything awaiting
      // it) indefinitely. Unref'd so a still-pending probe can never hold
      // the process open on its own.
      const hardTimeout = setTimeout(() => {
        if (settled) return;
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        done(false);
      }, 4000).unref();
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
      const exe = resolveWindowsShim(command);
      proc = spawn(exe.command, [...exe.prefixArgs, ...args, testPrompt], {
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
            error:
              "Parser produced a malformed event (missing type or timestamp)",
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
