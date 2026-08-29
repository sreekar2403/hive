import { describe, expect, it, vi } from "vitest";
import {
  branchNameFor,
  commitAll,
  listWorktrees,
  mergeAll,
  mergeBranch,
  type GitRunner,
} from "./branches";

/** A git that answers from a script keyed by the first two arguments. */
function fakeGit(
  script: Record<string, { ok: boolean; output: string }>,
  log?: string[][],
): GitRunner {
  return vi.fn((args: string[]) => {
    log?.push(args);
    const key = args.slice(0, 2).join(" ");
    return script[key] ?? script[args[0]] ?? { ok: true, output: "" };
  });
}

describe("branchNameFor", () => {
  it("slugs a prompt into a legal branch name", () => {
    expect(branchNameFor("abcdef1234", "Add the login form")).toBe(
      "hive/add-the-login-form-cdef1234",
    );
  });

  it("drops characters git will not accept", () => {
    const name = branchNameFor("abcdef1234", "fix: the ~thing~ (again)!");
    expect(name).toBe("hive/fix-the-thing-again-cdef1234");
    expect(name).not.toMatch(/[~^:?*[\] ]/);
  });

  it("falls back to the task id when there is nothing to slug", () => {
    expect(branchNameFor("abcdef1234", "!!!")).toBe("hive/task-cdef1234");
    expect(branchNameFor("abcdef1234")).toBe("hive/task-cdef1234");
  });

  it("keeps long prompts short enough to be usable", () => {
    const name = branchNameFor("abcdef1234", "a".repeat(200));
    expect(name.length).toBeLessThanOrEqual(50);
  });

  /*
   * The regression: ids are minted as `task_<epoch-ms>_<random>`, whose
   * first eight characters are the constant "task_178" for years. Taking
   * the head gave two sub-agents of one fan-out the same branch, and the
   * second lost its worktree to "a worktree already exists".
   */
  it("distinguishes tasks whose prompts open identically", () => {
    const prompt =
      "Read the PRD file in the current working directory, then create a comprehensive PRD";
    const first = branchNameFor("task_1787899181000_a1b2c3", prompt);
    const second = branchNameFor("task_1787899181004_z9y8x7", prompt);

    expect(first).not.toBe(second);
  });

  it("uses the distinctive tail of a timestamped id", () => {
    expect(branchNameFor("task_1787899181000_a1b2c3", "ship it")).toBe(
      "hive/ship-it-a1b2c3",
    );
  });

  it("still produces something usable for a short id", () => {
    expect(branchNameFor("x", "ship it")).toBe("hive/ship-it-x");
  });
});

describe("mergeBranch", () => {
  it("merges cleanly and reports no conflicts", () => {
    const outcome = mergeBranch("/repo", "hive/x", "main", fakeGit({}));
    expect(outcome).toEqual({ ok: true, conflicts: [] });
  });

  it("reports the conflicting files and aborts the merge", () => {
    const calls: string[][] = [];
    const git = fakeGit(
      {
        "merge --no-ff": { ok: false, output: "CONFLICT" },
        "diff --name-only": { ok: true, output: "src/a.ts\nsrc/b.ts\n" },
      },
      calls,
    );

    const outcome = mergeBranch("/repo", "hive/x", "main", git);

    expect(outcome.ok).toBe(false);
    expect(outcome.conflicts).toEqual(["src/a.ts", "src/b.ts"]);
    // The repository must be left as it was found.
    expect(calls).toContainEqual(["merge", "--abort"]);
  });

  it("fails without merging when the target branch cannot be checked out", () => {
    const calls: string[][] = [];
    const git = fakeGit(
      {
        "checkout main": {
          ok: false,
          output: "local changes would be overwritten",
        },
      },
      calls,
    );

    const outcome = mergeBranch("/repo", "hive/x", "main", git);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/would be overwritten/);
    expect(calls.some((c) => c[0] === "merge")).toBe(false);
  });
});

describe("mergeAll", () => {
  it("merges every branch when they all apply", () => {
    const result = mergeAll("/repo", ["hive/a", "hive/b"], "main", fakeGit({}));
    expect(result.merged).toEqual(["hive/a", "hive/b"]);
    expect(result.failed).toBeNull();
  });

  it("stops at the first conflict and says which branch it was", () => {
    let merges = 0;
    const git: GitRunner = vi.fn((args: string[]) => {
      if (args[0] === "merge" && args[1] === "--no-ff") {
        merges++;
        return merges === 1
          ? { ok: true, output: "" }
          : { ok: false, output: "CONFLICT" };
      }
      if (args[0] === "diff") return { ok: true, output: "src/a.ts\n" };
      return { ok: true, output: "" };
    });

    const result = mergeAll(
      "/repo",
      ["hive/a", "hive/b", "hive/c"],
      "main",
      git,
    );

    expect(result.merged).toEqual(["hive/a"]);
    expect(result.failed?.branch).toBe("hive/b");
    expect(result.failed?.outcome.conflicts).toEqual(["src/a.ts"]);
  });
});

describe("commitAll", () => {
  it("reports an untouched tree without making an empty commit", () => {
    const calls: string[][] = [];
    const git = fakeGit(
      { "status --porcelain": { ok: true, output: "" } },
      calls,
    );

    const result = commitAll("/wt", "task: x", git);

    expect(result).toEqual({ ok: true, committed: false });
    expect(calls.some((c) => c[0] === "commit")).toBe(false);
  });

  it("stages and commits when there is something to commit", () => {
    const calls: string[][] = [];
    const git = fakeGit(
      { "status --porcelain": { ok: true, output: " M src/a.ts\n" } },
      calls,
    );

    expect(commitAll("/wt", "task: x", git)).toEqual({
      ok: true,
      committed: true,
    });
    expect(calls).toContainEqual(["add", "-A"]);
    expect(calls).toContainEqual(["commit", "-m", "task: x"]);
  });

  it("surfaces a failing commit rather than claiming success", () => {
    const git = fakeGit({
      "status --porcelain": { ok: true, output: " M a.ts\n" },
      "commit -m": {
        ok: false,
        output: "nothing to commit, working tree clean",
      },
    });

    const result = commitAll("/wt", "task: x", git);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing to commit/);
  });
});

describe("listWorktrees", () => {
  it("parses git's porcelain output and ignores the main checkout", () => {
    const git = fakeGit({
      "worktree list": {
        ok: true,
        output: [
          "worktree /repo",
          "HEAD abc",
          "branch refs/heads/main",
          "",
          "worktree /repo/.hive-worktrees/hive_task-1",
          "HEAD def",
          "branch refs/heads/hive/task-1",
          "",
        ].join("\n"),
      },
    });

    expect(listWorktrees("/repo", git)).toEqual([
      { path: "/repo/.hive-worktrees/hive_task-1", branch: "hive/task-1" },
    ]);
  });

  it("returns nothing when git cannot answer", () => {
    const git = fakeGit({
      "worktree list": { ok: false, output: "not a git repository" },
    });
    expect(listWorktrees("/repo", git)).toEqual([]);
  });
});
