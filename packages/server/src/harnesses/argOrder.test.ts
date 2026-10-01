import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HarnessAttachment } from "@hive/shared/harness";
import { OpenCodeHarness } from "./opencode";
import { ClaudeCodeHarness } from "./claudeCode";
import { CodexHarness } from "./codex";
import { GeminiHarness } from "./gemini";
import { CursorAgentHarness } from "./cursorAgent";
import { PiHarness } from "./pi";
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

describe("resume arguments", () => {
  // One native session per chat+harness: the second turn on the same
  // harness resumes it, a harness switch (no resumeSessionId passed)
  // starts fresh. Flags verified against the real CLIs (Task 1 matrix).
  it("claude adds --resume only when resuming", async () => {
    await new ClaudeCodeHarness().execute("go");
    expect(captured).not.toContain("--resume");

    await new ClaudeCodeHarness().execute("go", { resumeSessionId: "ses_1" });
    const i = captured.indexOf("--resume");
    expect(i).toBeGreaterThan(-1);
    expect(captured[i + 1]).toBe("ses_1");
  });

  it("opencode adds --session only when resuming, before the prompt", async () => {
    await new OpenCodeHarness().execute("go");
    expect(captured).not.toContain("--session");

    await new OpenCodeHarness().execute("go", { resumeSessionId: "ses_2" });
    const flag = captured.indexOf("--session");
    expect(flag).toBeGreaterThan(-1);
    expect(captured[flag + 1]).toBe("ses_2");
    // Flags stay before the positional prompt (variadic --file rule above).
    expect(flag).toBeLessThan(captured.indexOf("go"));
  });

  it("codex uses the resume subcommand with the thread id", async () => {
    await new CodexHarness().execute("go");
    expect(captured.slice(0, 2)).toEqual(["exec", "--json"]);

    await new CodexHarness().execute("go", { resumeSessionId: "thr_1" });
    expect(captured.slice(0, 3)).toEqual(["exec", "resume", "--json"]);
    expect(captured).toContain("thr_1");
    expect(captured).toContain("--skip-git-repo-check");
  });

  it("pi adds --session only when resuming", async () => {
    await new PiHarness().execute("go");
    expect(captured).not.toContain("--session");

    await new PiHarness().execute("go", { resumeSessionId: "pi_ses_3" });
    const i = captured.indexOf("--session");
    expect(i).toBeGreaterThan(-1);
    expect(captured[i + 1]).toBe("pi_ses_3");
  });

  it("gemini adds --resume only when resuming", async () => {
    await new GeminiHarness().execute("go");
    expect(captured).not.toContain("--resume");

    await new GeminiHarness().execute("go", { resumeSessionId: "gem_4" });
    const i = captured.indexOf("--resume");
    expect(i).toBeGreaterThan(-1);
    expect(captured[i + 1]).toBe("gem_4");
  });

  it("cursor-agent adds --resume only when resuming", async () => {
    await new CursorAgentHarness().execute("go");
    expect(captured).not.toContain("--resume");

    await new CursorAgentHarness().execute("go", { resumeSessionId: "cur_5" });
    const i = captured.indexOf("--resume");
    expect(i).toBeGreaterThan(-1);
    expect(captured[i + 1]).toBe("cur_5");
  });
});
