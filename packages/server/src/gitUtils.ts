import { execSync, execFileSync } from "child_process";
import * as path from "path";

/** Runs a git command in `cwd`, returning null instead of throwing. */
export function git(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Runs `git` with an argument array via `execFileSync` — no shell is
 * spawned, so arguments (file paths, refs, ...) never pass through shell
 * interpolation even when they contain spaces or shell metacharacters.
 * Prefer this over `git()` for any command built from request input.
 */
export function gitArgs(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    const withStdout = err as { stdout?: string };
    if (typeof withStdout.stdout === "string" && withStdout.stdout.length > 0) {
      return withStdout.stdout;
    }
    return null;
  }
}

/**
 * True if `relPath` resolves to somewhere inside `cwd`. Used to guard any
 * route that takes a file path from the client before handing it to git
 * or the filesystem — rejects absolute paths and `..` traversal.
 */
export function isPathWithinRepo(cwd: string, relPath: string): boolean {
  if (!relPath || path.isAbsolute(relPath)) return false;
  const base = path.resolve(cwd);
  const resolved = path.resolve(base, relPath);
  return resolved === base || resolved.startsWith(base + path.sep);
}

export function isGitRepo(cwd: string): boolean {
  return git("git rev-parse --is-inside-work-tree", cwd)?.trim() === "true";
}

export function currentBranch(cwd: string): string | null {
  return git("git rev-parse --abbrev-ref HEAD", cwd)?.trim() ?? null;
}

/**
 * Lists files changed in a git working tree. Runs two separate commands
 * rather than a single shell pipeline with `2>/dev/null` fallbacks, since
 * that POSIX redirection is not portable to Windows' cmd.exe (the default
 * shell execSync uses there).
 */
export function detectFilesChanged(cwd: string): string[] {
  const output =
    git("git diff --name-only HEAD", cwd) ??
    git("git status --porcelain", cwd) ??
    "";

  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}
