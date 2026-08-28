import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HarnessAttachment } from "@hive/shared/harness";
import { OpenCodeHarness } from "./opencode";
import { CodexHarness } from "./codex";
import * as runner from "./runner";

/**
 * What each adapter actually puts on the command line.
 *
 * Argument *order* is load-bearing here and was the cause of a real
 * failure, so it is asserted rather than assumed: opencode declares
 * `--file` as variadic, so a prompt placed after it is consumed as another
 * filename and the run dies with `File not found: <the whole prompt>`.
 */
const png: HarnessAttachment = {
  path: "C:/tmp/shot.png",
  name: "shot.png",
  mimeType: "image/png",
};
const csv: HarnessAttachment = {
  path: "C:/tmp/rows.csv",
  name: "rows.csv",
  mimeType: "text/csv",
};

let captured: string[] = [];

beforeEach(() => {
  captured = [];
  vi.spyOn(runner, "runHarness").mockImplementation(async (spec) => {
    captured = spec.args;
    return {
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      output: "",
      filesChanged: [],
      duration: 1,
      events: [],
    };
  });
});
afterEach(() => vi.restoreAllMocks());

describe("opencode arguments", () => {
  it("puts the prompt before --file, because --file is variadic", async () => {
    await new OpenCodeHarness().execute("do the thing", { attachments: [png] });

    const prompt = captured.indexOf("do the thing");
    const file = captured.indexOf("--file");
    expect(prompt).toBeGreaterThan(-1);
    expect(file).toBeGreaterThan(-1);
    expect(prompt).toBeLessThan(file);
  });

  it("passes every attachment natively, whatever the type", async () => {
    await new OpenCodeHarness().execute("go", { attachments: [png, csv] });
    expect(captured.filter((a) => a === "--file")).toHaveLength(2);
    expect(captured).toContain("C:/tmp/rows.csv");
    // Nothing needs naming in the prompt when the CLI takes it natively.
    expect(captured).toContain("go");
  });

  it("adds no --file when nothing is attached", async () => {
    await new OpenCodeHarness().execute("go");
    expect(captured).not.toContain("--file");
  });
});

describe("codex arguments", () => {
  it("sends images through --image", async () => {
    await new CodexHarness().execute("go", { attachments: [png] });
    const image = captured.indexOf("--image");
    expect(image).toBeGreaterThan(-1);
    expect(captured[image + 1]).toBe("C:/tmp/shot.png");
  });

  it("never sends a non-image to --image, which would fail the run", async () => {
    await new CodexHarness().execute("go", { attachments: [csv] });
    expect(captured).not.toContain("--image");
    // It still has to reach the agent, so it is named in the prompt.
    expect(captured.some((a) => a.includes("C:/tmp/rows.csv"))).toBe(true);
  });
});
