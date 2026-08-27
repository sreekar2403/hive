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
