import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Isolated working trees for parallel agents.
 *
 * Running several harnesses at once against one checkout does not work:
 * they edit the same files, and `git diff` cannot tell whose change is
 * whose. Each parallel task therefore gets its own git worktree — a real
 * directory on a real branch, sharing the repository's object store — so
 * agents can work simultaneously without seeing each other's edits, and
 * each branch can be reviewed and merged on its own.
 *
 * Every git call goes through an injectable runner so this is testable
 * without a repository, and so a failure surfaces as a result rather than
 * an exception thrown from inside a task.
 */

export interface GitRun {
  ok: boolean;
  output: string;
}

export type GitRunner = (args: string[], cwd: string) => GitRun;

export const runGit: GitRunner = (args, cwd) => {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    return { ok: true, output: output ?? "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output:
        `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() ||
        e.message ||
        "git failed",
    };
  }
};

/**
 * A branch name that is legal in git and traceable back to the task.
 *
 * git refuses a lot of characters a prompt happily contains, and a rejected
 * branch name would fail the task for a reason that has nothing to do with
 * the work.
 */
export function branchNameFor(taskId: string, label?: string): string {
  const slug = (label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return slug
    ? `hive/${slug}-${shortId(taskId)}`
    : `hive/task-${shortId(taskId)}`;
}

/**
 * The part of a task id that actually distinguishes it.
 *
 * This used to be `taskId.slice(0, 8)`, which for the ids the Orchestrator
 * mints — `task_<epoch-ms>_<random>` — is the constant `"task_178"` and
 * stays constant for years. Two tasks whose prompts share a 32-character
 * prefix therefore produced the *same* branch name, and the second
 * worktree failed with "a worktree already exists".
 *
 * Sub-agents from one fan-out are exactly that case: their prompts are
 * generated from one request and open identically, so the collision was
 * not a rare tie but the normal outcome. Taking the tail keeps the random
 * suffix, and a uuid's tail is just as distinctive as its head.
 */
function shortId(taskId: string): string {
  const tail = taskId.split(/[_-]/).filter(Boolean).pop() ?? taskId;
  const candidate = tail.length >= 6 ? tail : taskId.replace(/[^a-z0-9]/gi, "");
  return candidate.slice(-8) || "task";
}

export interface Worktree {
  branch: string;
  /** Absolute path of the isolated checkout. */
  path: string;
}

/** Where worktrees live: beside the repo, never inside it. */
export function worktreeRoot(repoPath: string): string {
  return path.join(repoPath, ".hive-worktrees");
}

export function isGitRepo(repoPath: string, git: GitRunner = runGit): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], repoPath).ok;
}

/**
 * Creates a branch and an isolated checkout of it.
 *
 * `base` defaults to the repository's current HEAD, which is what a person
 * would expect from "start a task here".
 */
export function createWorktree(
  repoPath: string,
  branch: string,
  base?: string,
  git: GitRunner = runGit,
): { ok: boolean; worktree?: Worktree; error?: string } {
  if (!isGitRepo(repoPath, git)) {
    return { ok: false, error: `${repoPath} is not a git working tree.` };
  }

  const dir = path.join(worktreeRoot(repoPath), branch.replace(/[/\\]/g, "_"));
  if (fs.existsSync(dir)) {
    // Reusing a directory from an interrupted run would put the agent in a
    // tree whose state nobody can account for.
    return { ok: false, error: `A worktree already exists at ${dir}.` };
  }

  const args = ["worktree", "add", "-b", branch, dir];
  if (base) args.push(base);
  const result = git(args, repoPath);
  if (!result.ok) return { ok: false, error: result.output };

  return { ok: true, worktree: { branch, path: dir } };
}

/**
 * Removes a worktree. `force` discards uncommitted work in it, which is
 * only correct once its changes are merged or deliberately abandoned.
 */
export function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false,
  git: GitRunner = runGit,
): { ok: boolean; error?: string } {
  const args = ["worktree", "remove", worktreePath];
  if (force) args.push("--force");
  const result = git(args, repoPath);
  return result.ok ? { ok: true } : { ok: false, error: result.output };
}

export function listWorktrees(
  repoPath: string,
  git: GitRunner = runGit,
): Worktree[] {
  const result = git(["worktree", "list", "--porcelain"], repoPath);
  if (!result.ok) return [];

  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> = {};
  for (const line of result.output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    } else if (line.trim() === "" && current.path) {
      // The main checkout has no hive branch and is not ours to manage.
      if (current.branch) worktrees.push(current as Worktree);
      current = {};
    }
  }
  if (current.path && current.branch) worktrees.push(current as Worktree);
  return worktrees.filter((w) => w.branch.startsWith("hive/"));
}

/** Uncommitted changes in a worktree, staged or not. */
export function hasChanges(
  worktreePath: string,
  git: GitRunner = runGit,
): boolean {
  const result = git(["status", "--porcelain"], worktreePath);
  return result.ok && result.output.trim().length > 0;
}

/**
 * Commits everything in a worktree. Returns false when there was nothing to
 * commit, which is not an error — an agent that changed nothing is a real
 * outcome the caller has to be able to see.
 */
export function commitAll(
  worktreePath: string,
  message: string,
  git: GitRunner = runGit,
): { ok: boolean; committed: boolean; error?: string } {
  if (!hasChanges(worktreePath, git)) {
    return { ok: true, committed: false };
  }
  const add = git(["add", "-A"], worktreePath);
  if (!add.ok) return { ok: false, committed: false, error: add.output };
  const commit = git(["commit", "-m", message], worktreePath);
  if (!commit.ok) return { ok: false, committed: false, error: commit.output };
  return { ok: true, committed: true };
}

export interface MergeOutcome {
  ok: boolean;
  /** Files git could not merge on its own. Empty unless `ok` is false. */
  conflicts: string[];
  error?: string;
}

/**
 * Merges a task branch into `target` in the main checkout.
 *
 * Conflicts are reported, not resolved, and the merge is aborted so the
 * repository is left exactly as it was found. Resolving someone else's
 * conflict silently is the one outcome nobody can review.
 */
export function mergeBranch(
  repoPath: string,
  branch: string,
  target = "main",
  git: GitRunner = runGit,
): MergeOutcome {
  const checkout = git(["checkout", target], repoPath);
  if (!checkout.ok) return { ok: false, conflicts: [], error: checkout.output };

  const merge = git(["merge", "--no-ff", branch], repoPath);
  if (merge.ok) return { ok: true, conflicts: [] };

  const conflicted = git(["diff", "--name-only", "--diff-filter=U"], repoPath);
  const conflicts = conflicted.ok
    ? conflicted.output
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  git(["merge", "--abort"], repoPath);
  return {
    ok: false,
    conflicts,
    error: conflicts.length
      ? `Merge conflicts in ${conflicts.length} file(s); the merge was aborted.`
      : merge.output,
  };
}

/**
 * Merges several task branches one at a time, stopping at the first
 * conflict.
 *
 * Sequential on purpose: branch two's conflicts depend on whether branch
 * one landed, so merging them "in parallel" would only mean reporting
 * results that were never true together.
 */
export function mergeAll(
  repoPath: string,
  branches: string[],
  target = "main",
  git: GitRunner = runGit,
): {
  merged: string[];
  failed: { branch: string; outcome: MergeOutcome } | null;
} {
  const merged: string[] = [];
  for (const branch of branches) {
    const outcome = mergeBranch(repoPath, branch, target, git);
    if (!outcome.ok) return { merged, failed: { branch, outcome } };
    merged.push(branch);
  }
  return { merged, failed: null };
}
