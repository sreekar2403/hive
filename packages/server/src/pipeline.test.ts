import { describe, expect, it, vi } from "vitest";
import {
  detectTestCommand,
  reviewDiff,
  runPipeline,
  type StageName,
  type StageRunner,
} from "./pipeline";

/** A harness that always succeeds and reports the files it was told to. */
function runner(
  perStage: Partial<
    Record<
      StageName,
      {
        success?: boolean;
        output?: string;
        filesChanged?: string[];
        stderr?: string;
      }
    >
  > = {},
): StageRunner {
  return vi.fn(async ({ stage }: { stage: StageName }) => {
    const scripted = perStage[stage];
    return {
      success: scripted?.success ?? true,
      output: scripted?.output ?? `${stage} done`,
      filesChanged: scripted?.filesChanged ?? [],
      stderr: scripted?.stderr,
    };
  });
}

const passingExec = (command: string) =>
  command.startsWith("git diff")
    ? { ok: true, output: "+ const x = 1;\n" }
    : { ok: true, output: "all tests passed" };

describe("runPipeline", () => {
  it("runs plan → implement → test → review → ship when everything passes", async () => {
    const result = await runPipeline(
      "add a widget",
      runner({ implement: { filesChanged: ["src/widget.ts"] } }),
      { cwd: "/repo", testCommand: "npm test", exec: passingExec },
    );

    expect(result.success).toBe(true);
    expect(result.stages.map((s) => s.stage)).toEqual([
      "plan",
      "implement",
      "test",
      "review",
      "ship",
    ]);
    expect(result.filesChanged).toEqual(["src/widget.ts"]);
  });

  it("fails the implement stage when the working tree is untouched", async () => {
    // The whole point of the gate: exiting zero is not evidence of work.
    const result = await runPipeline("add a widget", runner(), {
      cwd: "/repo",
      testCommand: "npm test",
      exec: passingExec,
    });

    expect(result.success).toBe(false);
    expect(result.stoppedAt).toBe("implement");
    expect(result.reason).toMatch(/changed no files/i);
  });

  it("sends failing tests back to implement, then gives up after maxRepairs", async () => {
    const exec = vi.fn((command: string) =>
      command.startsWith("git diff")
        ? { ok: true, output: "" }
        : { ok: false, output: "1 failing" },
    );
    const stage = runner({ implement: { filesChanged: ["a.ts"] } });

    const result = await runPipeline("fix it", stage, {
      cwd: "/repo",
      testCommand: "npm test",
      maxRepairs: 2,
      exec,
    });

    expect(result.success).toBe(false);
    expect(result.stoppedAt).toBe("test");
    // One initial implement plus two repairs.
    const implementRuns = result.stages.filter((s) => s.stage === "implement");
    expect(implementRuns).toHaveLength(3);
    expect(result.reason).toMatch(/still fail/i);
  });

  it("recovers when a repair attempt makes the tests pass", async () => {
    let testRuns = 0;
    const exec = (command: string) => {
      if (command.startsWith("git diff")) return { ok: true, output: "" };
      testRuns++;
      return testRuns === 1
        ? { ok: false, output: "1 failing" }
        : { ok: true, output: "ok" };
    };

    const result = await runPipeline(
      "fix it",
      runner({ implement: { filesChanged: ["a.ts"] } }),
      { cwd: "/repo", testCommand: "npm test", exec },
    );

    expect(result.success).toBe(true);
    expect(result.stages.filter((s) => s.stage === "implement")).toHaveLength(
      2,
    );
  });

  it("skips testing rather than inventing a command", async () => {
    const result = await runPipeline(
      "tweak the docs",
      runner({ implement: { filesChanged: ["README.md"] } }),
      { cwd: "/repo", testCommand: null, exec: passingExec },
    );

    const test = result.stages.find((s) => s.stage === "test");
    expect(test?.verdict).toBe("skipped");
    expect(result.success).toBe(true);
  });

  it("blocks at review when the diff carries conflict markers", async () => {
    const exec = (command: string) =>
      command.startsWith("git diff")
        ? { ok: true, output: "+<<<<<<< HEAD\n+const x = 1;\n" }
        : { ok: true, output: "ok" };

    const result = await runPipeline(
      "merge it",
      runner({ implement: { filesChanged: ["a.ts"] } }),
      { cwd: "/repo", testCommand: "npm test", exec },
    );

    expect(result.success).toBe(false);
    expect(result.stoppedAt).toBe("review");
    expect(result.reason).toMatch(/conflict marker/i);
  });

  it("lets a judge block a change the heuristics allow", async () => {
    const result = await runPipeline(
      "add a widget",
      runner({ implement: { filesChanged: ["a.ts"] } }),
      {
        cwd: "/repo",
        testCommand: "npm test",
        exec: passingExec,
        judge: async () => ({
          approved: false,
          reason: "Does not do what was asked.",
        }),
      },
    );

    expect(result.success).toBe(false);
    expect(result.stoppedAt).toBe("review");
    expect(result.reason).toBe("Does not do what was asked.");
  });

  it("keeps going when the judge has no view", async () => {
    const result = await runPipeline(
      "add a widget",
      runner({ implement: { filesChanged: ["a.ts"] } }),
      {
        cwd: "/repo",
        testCommand: "npm test",
        exec: passingExec,
        judge: async () => null,
      },
    );

    expect(result.success).toBe(true);
  });

  it("stops when the harness itself asks for changes", async () => {
    const result = await runPipeline(
      "add a widget",
      runner({
        implement: { filesChanged: ["a.ts"] },
        review: { output: "REQUEST_CHANGES\nthe error path is unhandled" },
      }),
      { cwd: "/repo", testCommand: "npm test", exec: passingExec },
    );

    expect(result.success).toBe(false);
    expect(result.stoppedAt).toBe("review");
  });

  it("stops at plan when the harness errors out", async () => {
    const result = await runPipeline(
      "add a widget",
      runner({ plan: { success: false, stderr: "model unavailable" } }),
      { cwd: "/repo", testCommand: "npm test", exec: passingExec },
    );

    expect(result.stoppedAt).toBe("plan");
    expect(result.stages[0].reason).toMatch(/model unavailable/);
  });

  it("can skip planning entirely", async () => {
    const result = await runPipeline(
      "one-liner",
      runner({ implement: { filesChanged: ["a.ts"] } }),
      { cwd: "/repo", plan: false, testCommand: "npm test", exec: passingExec },
    );

    expect(result.stages[0]).toMatchObject({
      stage: "plan",
      verdict: "skipped",
    });
  });

  it("reports each stage as it starts and ends", async () => {
    const seen: string[] = [];
    await runPipeline(
      "add a widget",
      runner({ implement: { filesChanged: ["a.ts"] } }),
      {
        cwd: "/repo",
        testCommand: "npm test",
        exec: passingExec,
        onStage: (stage, phase) => seen.push(`${stage}:${phase}`),
      },
    );

    expect(seen).toContain("implement:start");
    expect(seen).toContain("ship:end");
  });
});

describe("reviewDiff", () => {
  it("approves an ordinary diff", () => {
    expect(reviewDiff("+const x = 1;\n-const y = 2;\n").approved).toBe(true);
  });

  it("rejects a left-behind debugger statement", () => {
    expect(reviewDiff("+  debugger;\n").approved).toBe(false);
  });

  it("rejects a focused test", () => {
    const verdict = reviewDiff('+it.only("works", () => {});\n');
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/focused or skipped/i);
  });

  it("rejects a new FIXME", () => {
    expect(reviewDiff("+// FIXME: handle the null case\n").approved).toBe(
      false,
    );
  });

  it("ignores markers that were only removed", () => {
    expect(reviewDiff("-  debugger;\n-// FIXME: old\n").approved).toBe(true);
  });

  it("does not mistake the +++ file header for an added line", () => {
    expect(reviewDiff("+++ b/debugger.ts\n+const ok = 1;\n").approved).toBe(
      true,
    );
  });
});

describe("detectTestCommand", () => {
  it("returns null for a directory with no project in it", () => {
    expect(detectTestCommand("/definitely/not/a/repo")).toBeNull();
  });

  it("finds this repo's own test command", () => {
    // The repo root is three levels up from packages/server/src.
    const root = new URL("../../..", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    );
    expect(detectTestCommand(root)).toBe("pnpm test");
  });
});
