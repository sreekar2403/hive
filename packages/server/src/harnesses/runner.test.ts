import { describe, it, expect } from "vitest";
import { runHarness } from "./runner";
import { LineTextParser, OpenCodeParser } from "./eventStream";

/**
 * Cancellation is the plumbing the runtime permission guard stands on: if
 * aborting doesn't actually kill the child, a destructive command keeps
 * running after the gate says stop. So this exercises a real subprocess
 * rather than a mock.
 */
describe("runHarness cancellation", () => {
  it("kills a running child and reports it as aborted", async () => {
    const controller = new AbortController();

    // A child that would otherwise sit there for a minute.
    const run = runHarness({
      command: process.execPath,
      args: ["-e", "setTimeout(() => console.log('finished'), 60000)"],
      parser: new LineTextParser(),
      options: { signal: controller.signal },
    });

    setTimeout(() => controller.abort(), 100);

    const result = await run;
    expect(result.aborted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.stdout).not.toContain("finished");
  }, 15000);

  it("reports a normal run as not aborted", async () => {
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "console.log('hello')"],
      parser: new LineTextParser(),
    });

    expect(result.aborted).toBe(false);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello");
  }, 15000);

  it("does not start a child that is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "console.log('should not matter')"],
      parser: new LineTextParser(),
      options: { signal: controller.signal },
    });

    expect(result.aborted).toBe(true);
    expect(result.success).toBe(false);
  }, 15000);
});

describe("runHarness with a missing binary", () => {
  it("resolves as a failed run instead of rejecting", async () => {
    // A CLI that isn't installed is normal here — startup probes twelve of
    // them. This used to reject, which surfaced in CI as an unhandled
    // rejection that killed the vitest worker.
    const result = await runHarness({
      command: "definitely-not-a-real-binary-xyz",
      args: ["--version"],
      parser: new LineTextParser(),
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("not installed or not on PATH");
    expect(result.filesChanged).toEqual([]);
  }, 15000);

  it("settles once even though error and close both fire", async () => {
    // Node emits ENOENT and then closes the process; a double-settle would
    // have run the git diff a second time.
    const result = await runHarness({
      command: "definitely-not-a-real-binary-xyz",
      args: [],
      parser: new LineTextParser(),
    });
    expect(result.aborted).toBe(false);
    expect(result.output).toContain("definitely-not-a-real-binary-xyz");
  }, 15000);
});

/**
 * `HarnessOptions.timeout` was declared and never honoured, so
 * `loop.timeoutMs` was decorative and a stuck CLI ran until somebody
 * noticed. These pin that it is enforced, and that a deadline is reported
 * as its own thing rather than as a cancellation.
 */
describe("runHarness deadline", () => {
  it("kills a child that outstays its budget", async () => {
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "setTimeout(() => console.log('finished'), 60000)"],
      parser: new LineTextParser(),
      options: { timeout: 300 },
    });

    expect(result.timedOut).toBe(true);
    expect(result.success).toBe(false);
    expect(result.stdout).not.toContain("finished");
  }, 15000);

  it("says a timeout happened rather than failing silently", async () => {
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      parser: new LineTextParser(),
      options: { timeout: 300 },
    });

    expect(result.stderr).toContain("did not finish within");
    expect(result.output).toContain("did not finish within");
  }, 15000);

  it("does not report a deadline as a cancellation", async () => {
    // The loop stops outright on `aborted` — somebody chose to stop this.
    // A timeout is a failure to retry, so it must not land in that branch.
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      parser: new LineTextParser(),
      options: { timeout: 300 },
    });

    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
  }, 15000);

  it("leaves a run that finishes in time alone", async () => {
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "console.log('quick')"],
      parser: new LineTextParser(),
      options: { timeout: 10000 },
    });

    expect(result.timedOut).toBe(false);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("quick");
  }, 15000);

  it("runs without a deadline when none is given", async () => {
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "console.log('unbounded')"],
      parser: new LineTextParser(),
    });

    expect(result.timedOut).toBe(false);
    expect(result.success).toBe(true);
  }, 15000);
});

/**
 * The silence watchdog. A CLI that has stopped talking is the case the run
 * deadline handles badly: it is indistinguishable from a slow one until the
 * whole budget is gone, and by then the loop has learned nothing it can act
 * on. Real subprocesses again — the behaviour under test is when pipes go
 * quiet, which a mock cannot reproduce.
 */
describe("runHarness silence detection", () => {
  it("stops a child that prints nothing and reports it as silent", async () => {
    // Exactly the observed shape: a header, then nothing, forever.
    const result = await runHarness({
      command: process.execPath,
      args: [
        "-e",
        "console.log('session started'); setTimeout(() => console.log('never'), 60000)",
      ],
      parser: new LineTextParser(),
      options: { idleTimeout: 1000 },
    });

    expect(result.silent).toBe(true);
    // Not a cancellation — nobody chose this — and not the run deadline.
    expect(result.aborted).toBe(false);
    expect(result.timedOut).toBeFalsy();
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/no output/i);
    expect(result.stdout).not.toContain("never");
  }, 20000);

  it("leaves a slow but talking child alone", async () => {
    // Output well inside the idle budget: this one is working, just not
    // quickly, and killing it would be the wrong call.
    const result = await runHarness({
      command: process.execPath,
      args: [
        "-e",
        "let n = 0; const t = setInterval(() => { console.log('tick'); if (++n === 6) { clearInterval(t); console.log('done'); } }, 200)",
      ],
      parser: new LineTextParser(),
      options: { idleTimeout: 1000 },
    });

    expect(result.silent).toBe(false);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("done");
  }, 20000);

  it("reports a child that fails having said nothing at all as silent", async () => {
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      parser: new LineTextParser(),
    });

    expect(result.silent).toBe(true);
  }, 15000);

  it("does not call a quiet but successful run silent", async () => {
    // Exit 0 means it did the work. Some of these CLIs say almost nothing
    // while doing it, and treating that as a dead provider would throw
    // away a succeeded run and hand the task to somebody else to redo.
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      parser: new LineTextParser(),
    });

    expect(result.success).toBe(true);
    expect(result.silent).toBe(false);
  }, 15000);

  it("does not call a cancelled run silent", async () => {
    // A guard or a person stopping a run is a decision to respect, not a
    // dead CLI to route around.
    const controller = new AbortController();
    const run = runHarness({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      parser: new LineTextParser(),
      options: { signal: controller.signal },
    });
    setTimeout(() => controller.abort(), 100);

    const result = await run;
    expect(result.aborted).toBe(true);
    expect(result.silent).toBe(false);
  }, 15000);

  it("does nothing when no idle budget is set", async () => {
    const result = await runHarness({
      command: process.execPath,
      args: ["-e", "setTimeout(() => console.log('slow'), 1500)"],
      parser: new LineTextParser(),
      options: { idleTimeout: 0 },
    });

    expect(result.silent).toBe(false);
    expect(result.stdout).toContain("slow");
  }, 20000);
});

/**
 * A CLI that fails on stdout. Several of these report the failure as an
 * `error` event and exit non-zero with stderr empty — the observed case is
 * opencode pointed at a model its provider no longer serves. Nothing about
 * that run reached the two places anyone reads (the loop's retry check
 * looks at stderr, the chat window looks at output), so the task failed
 * with no visible reason at all.
 */
describe("runHarness error reporting", () => {
  const errorLine = JSON.stringify({
    type: "error",
    error: {
      name: "UnknownError",
      data: { message: "Unexpected server error" },
    },
  });

  it("lifts an error event out of the stream and into stderr and output", async () => {
    const result = await runHarness({
      command: process.execPath,
      args: [
        "-e",
        `console.log(${JSON.stringify(errorLine)}); process.exit(1)`,
      ],
      parser: new OpenCodeParser(),
    });

    expect(result.success).toBe(false);
    expect(result.stderr).toContain("Unexpected server error");
    expect(result.output).toContain("Unexpected server error");
  }, 15000);

  it("counts a run that only errored as silent, so the loop can switch harness", async () => {
    // It reported that it could not do the work. That is not an attempt at
    // the task, and no reword of the prompt fixes a dead provider.
    const result = await runHarness({
      command: process.execPath,
      args: [
        "-e",
        `console.log(${JSON.stringify(errorLine)}); process.exit(1)`,
      ],
      parser: new OpenCodeParser(),
    });

    expect(result.silent).toBe(true);
  }, 15000);

  it("does not call a run silent once the CLI has produced real output", async () => {
    // Answered, then failed. That is a normal failure with something to
    // learn from — it belongs on the retry path, not the switch path.
    const text = JSON.stringify({
      type: "text",
      part: { type: "text", text: "here is the patch" },
    });
    const result = await runHarness({
      command: process.execPath,
      args: [
        "-e",
        `console.log(${JSON.stringify(text)}); console.log(${JSON.stringify(errorLine)}); process.exit(1)`,
      ],
      parser: new OpenCodeParser(),
    });

    expect(result.silent).toBe(false);
    expect(result.stderr).toContain("Unexpected server error");
  }, 15000);
});
