import { describe, it, expect } from "vitest";
import { runHarness } from "./runner";
import { LineTextParser } from "./eventStream";

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
