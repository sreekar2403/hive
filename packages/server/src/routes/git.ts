import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { getDb } from "../db/database";
import { currentBranch, gitArgs, isGitRepo, isPathWithinRepo } from "../gitUtils";

const router: Router = Router();

/** A file's line-change kind, shared by the status and diff responses. */
type ChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "conflicted";

interface GitFileEntry {
  path: string;
  oldPath?: string;
  changeType: ChangeType;
  added: number | null;
  removed: number | null;
  binary: boolean;
}

/** Above this many changed lines a diff is served as metadata only. */
const MAX_DIFF_LINES = 3000;
/** Above this many bytes an untracked file isn't read for a synthetic diff. */
const MAX_UNTRACKED_BYTES = 1024 * 1024;

interface ProjectRow {
  id: string;
  name: string;
  path: string;
}

/**
 * Resolves `?projectId=` to a project row, verifying the folder exists
 * and is a git repo. Writes the error response itself and returns null
 * when it can't proceed, so callers just `if (!project) return;`.
 */
function resolveProject(req: Request, res: Response): ProjectRow | null {
  const projectId = req.query.projectId;
  if (typeof projectId !== "string" || !projectId) {
    res.status(400).json({ error: "A projectId is required" });
    return null;
  }

  const db = getDb();
  const row = db
    .prepare("SELECT id, name, path FROM projects WHERE id = ?")
    .get(projectId) as ProjectRow | undefined;

  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (!fs.existsSync(row.path)) {
    res.status(400).json({ error: `Project folder not found: ${row.path}` });
    return null;
  }
  if (!isGitRepo(row.path)) {
    res.status(400).json({ error: `${row.name} is not a git repository` });
    return null;
  }
  return row;
}

function changeTypeFromCode(code: string): ChangeType {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "conflicted";
    case "T":
    case "M":
    default:
      return "modified";
  }
}

interface NumstatEntry {
  added: number | null;
  removed: number | null;
  binary: boolean;
  oldPath?: string;
}

/**
 * `git diff --numstat` pathspecs are either a plain path, `old => new`, or
 * a brace-shortened rename like `src/{old => new}/file.ts`. This resolves
 * any of those to the final (new) path plus an optional old path, which
 * is what a rename's line counts need to be keyed by.
 */
function resolveNumstatPath(pathspec: string): { path: string; oldPath?: string } {
  const braceMatch = pathspec.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, oldPart, newPart, suffix] = braceMatch;
    return { path: `${prefix}${newPart}${suffix}`, oldPath: `${prefix}${oldPart}${suffix}` };
  }
  const arrowIdx = pathspec.indexOf(" => ");
  if (arrowIdx !== -1) {
    return {
      oldPath: pathspec.slice(0, arrowIdx),
      path: pathspec.slice(arrowIdx + 4),
    };
  }
  return { path: pathspec };
}

/** Runs `git diff --numstat` (optionally `--cached`) and keys results by final path. */
function numstatMap(cwd: string, cached: boolean): Map<string, NumstatEntry> {
  const args = ["diff", "--numstat", "-M"];
  if (cached) args.push("--cached");
  const out = gitArgs(args, cwd) ?? "";
  const map = new Map<string, NumstatEntry>();

  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [addedRaw, removedRaw, ...rest] = line.split("\t");
    const pathspec = rest.join("\t");
    const { path: p, oldPath } = resolveNumstatPath(pathspec);
    const binary = addedRaw === "-" || removedRaw === "-";
    map.set(p, {
      added: binary ? null : parseInt(addedRaw, 10),
      removed: binary ? null : parseInt(removedRaw, 10),
      binary,
      oldPath,
    });
  }
  return map;
}

/** Reads a small untracked file to report a line count, without invoking git. */
function untrackedStats(cwd: string, relPath: string): { added: number | null; binary: boolean } {
  try {
    const abs = path.join(cwd, relPath);
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) {
      return { added: null, binary: false };
    }
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return { added: null, binary: true };
    const text = buf.toString("utf8");
    if (text.length === 0) return { added: 0, binary: false };
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return { added: lines, binary: false };
  } catch {
    return { added: null, binary: false };
  }
}

// GET /api/git/status?projectId=
router.get("/status", (req: Request, res: Response) => {
  const project = resolveProject(req, res);
  if (!project) return;
  const cwd = project.path;

  const branch = currentBranch(cwd) ?? "HEAD";
  const raw = gitArgs(["status", "--porcelain=v2", "--branch"], cwd) ?? "";

  let ahead = 0;
  let behind = 0;
  let upstream: string | null = null;

  const stagedEntries: Array<{ path: string; oldPath?: string; code: string }> = [];
  const unstagedEntries: Array<{ path: string; oldPath?: string; code: string }> = [];
  const untrackedPaths: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.ab")) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) {
        ahead = parseInt(m[1], 10);
        behind = parseInt(m[2], 10);
      }
    } else if (line.startsWith("# branch.upstream")) {
      upstream = line.slice("# branch.upstream ".length).trim() || null;
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const isRename = line.startsWith("2 ");
      // "1 XY sub mH mI mW hH hI path"
      // "2 XY sub mH mI mW hH hI score path\toldPath"
      const fixedFieldCount = isRename ? 9 : 8;
      const parts = line.split(" ");
      const xy = parts[1];
      const restJoined = parts.slice(fixedFieldCount).join(" ");
      let filePath = restJoined;
      let oldPath: string | undefined;
      if (isRename) {
        const tabIdx = restJoined.indexOf("\t");
        if (tabIdx !== -1) {
          filePath = restJoined.slice(0, tabIdx);
          oldPath = restJoined.slice(tabIdx + 1);
        }
      }
      const [x, y] = xy;
      if (x !== ".") stagedEntries.push({ path: filePath, oldPath, code: x });
      if (y !== ".") unstagedEntries.push({ path: filePath, oldPath, code: y });
    } else if (line.startsWith("u ")) {
      // Unmerged/conflicted — surface as an unstaged conflict.
      const conflictPath = line.slice(line.lastIndexOf(" ") + 1);
      unstagedEntries.push({ path: conflictPath, code: "U" });
    } else if (line.startsWith("? ")) {
      untrackedPaths.push(line.slice(2));
    }
  }

  const stagedNumstat = numstatMap(cwd, true);
  const unstagedNumstat = numstatMap(cwd, false);

  const toEntry = (
    e: { path: string; oldPath?: string; code: string },
    numstat: Map<string, NumstatEntry>,
  ): GitFileEntry => {
    const stat = numstat.get(e.path);
    return {
      path: e.path,
      oldPath: e.oldPath ?? stat?.oldPath,
      changeType: changeTypeFromCode(e.code),
      added: stat?.added ?? null,
      removed: stat?.removed ?? null,
      binary: stat?.binary ?? false,
    };
  };

  const staged = stagedEntries.map((e) => toEntry(e, stagedNumstat));
  const unstaged = unstagedEntries.map((e) => toEntry(e, unstagedNumstat));
  const untracked: GitFileEntry[] = untrackedPaths.map((p) => {
    const { added, binary } = untrackedStats(cwd, p);
    return { path: p, changeType: "added", added, removed: 0, binary };
  });

  res.json({
    projectId: project.id,
    branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
  });
});

/** Strips the file-level header (diff --git/index/---/+++) leaving just hunks. */
function extractHunks(patch: string): string {
  const lines = patch.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  if (start === -1) return "";
  return lines.slice(start).join("\n");
}

function buildUntrackedPatch(cwd: string, relPath: string): { patch: string; added: number } | null {
  const abs = path.join(cwd, relPath);
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.length === 0 ? [] : text.split("\n");
  // A trailing empty element from a final newline isn't a real line.
  const contentLines = text.endsWith("\n") ? lines.slice(0, -1) : lines;
  const body = contentLines.map((l) => `+${l}`).join("\n");
  const patch = `@@ -0,0 +1,${contentLines.length} @@\n${body}`;
  return { patch, added: contentLines.length };
}

// GET /api/git/diff?projectId=&file=&staged=&context=
router.get("/diff", (req: Request, res: Response) => {
  const project = resolveProject(req, res);
  if (!project) return;
  const cwd = project.path;

  const file = req.query.file;
  if (typeof file !== "string" || !file) {
    return res.status(400).json({ error: "A file path is required" });
  }
  if (!isPathWithinRepo(cwd, file)) {
    return res.status(400).json({ error: "File path escapes the project folder" });
  }

  const staged = req.query.staged === "true";
  const contextRaw = req.query.context;
  const context =
    typeof contextRaw === "string" && /^\d+$/.test(contextRaw)
      ? Math.min(parseInt(contextRaw, 10), 1_000_000)
      : 3;

  // Untracked files never show up in `git diff` output at all — they need
  // a synthetic all-added patch built by reading the file directly.
  const statusLine = gitArgs(["status", "--porcelain=v2", "--", file], cwd) ?? "";
  const isUntracked = statusLine.trimStart().startsWith("?");

  if (isUntracked) {
    const abs = path.join(cwd, file);
    let size = 0;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) {
        return res.status(400).json({ error: "Not a file" });
      }
      size = stat.size;
    } catch {
      return res.status(404).json({ error: "File not found" });
    }
    if (size > MAX_UNTRACKED_BYTES) {
      return res.json({
        projectId: project.id,
        path: file,
        staged: false,
        changeType: "added",
        binary: false,
        tooLarge: true,
        added: null,
        removed: 0,
        patch: null,
      });
    }
    const buf = fs.readFileSync(abs);
    const binary = buf.subarray(0, 8000).includes(0);
    if (binary) {
      return res.json({
        projectId: project.id,
        path: file,
        staged: false,
        changeType: "added",
        binary: true,
        tooLarge: false,
        added: null,
        removed: 0,
        patch: null,
      });
    }
    const built = buildUntrackedPatch(cwd, file);
    return res.json({
      projectId: project.id,
      path: file,
      staged: false,
      changeType: "added",
      binary: false,
      tooLarge: false,
      added: built?.added ?? 0,
      removed: 0,
      patch: built?.patch ?? "",
    });
  }

  const numstat = numstatMap(cwd, staged);
  // The file may be keyed under its old path if it was renamed; find by
  // scanning both the new path and any matching oldPath.
  let stat = numstat.get(file);
  if (!stat) {
    for (const entry of numstat.values()) {
      if (entry.oldPath === file) {
        stat = entry;
        break;
      }
    }
  }

  const added = stat?.added ?? 0;
  const removed = stat?.removed ?? 0;
  const binary = stat?.binary ?? false;
  const changeType: ChangeType = stat?.oldPath ? "renamed" : "modified";

  if (binary) {
    return res.json({
      projectId: project.id,
      path: file,
      oldPath: stat?.oldPath,
      staged,
      changeType,
      binary: true,
      tooLarge: false,
      added: null,
      removed: null,
      patch: null,
    });
  }

  if (added + removed > MAX_DIFF_LINES) {
    return res.json({
      projectId: project.id,
      path: file,
      oldPath: stat?.oldPath,
      staged,
      changeType,
      binary: false,
      tooLarge: true,
      added,
      removed,
      patch: null,
    });
  }

  const args = ["diff", "-M", `--unified=${context}`];
  if (staged) args.push("--cached");
  args.push("--", file);
  const rawPatch = gitArgs(args, cwd) ?? "";
  const hunks = extractHunks(rawPatch);

  res.json({
    projectId: project.id,
    path: file,
    oldPath: stat?.oldPath,
    staged,
    changeType,
    binary: false,
    tooLarge: false,
    added,
    removed,
    patch: hunks,
  });
});

// GET /api/git/branches?projectId=
router.get("/branches", (req: Request, res: Response) => {
  const project = resolveProject(req, res);
  if (!project) return;
  const cwd = project.path;

  const out = gitArgs(["branch", "--format=%(refname:short)%09%(HEAD)"], cwd) ?? "";
  const branches = out
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [name, head] = line.split("\t");
      return { name, current: head === "*" };
    });

  res.json({ branches });
});

// GET /api/git/log?projectId=&limit=
router.get("/log", (req: Request, res: Response) => {
  const project = resolveProject(req, res);
  if (!project) return;
  const cwd = project.path;

  const limitRaw = req.query.limit;
  const limit =
    typeof limitRaw === "string" && /^\d+$/.test(limitRaw)
      ? Math.min(parseInt(limitRaw, 10), 500)
      : 50;

  const out =
    gitArgs(
      [
        "log",
        `-n${limit}`,
        "--format=%x1e%H%x1f%h%x1f%an%x1f%ar%x1f%s",
        "--shortstat",
      ],
      cwd,
    ) ?? "";

  const commits = out
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const firstNewline = chunk.indexOf("\n");
      const headerLine = firstNewline === -1 ? chunk : chunk.slice(0, firstNewline);
      const rest = firstNewline === -1 ? "" : chunk.slice(firstNewline);
      const [hash, shortHash, author, date, subject] = headerLine.split("\x1f");

      const statMatch = rest.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
      );

      return {
        hash,
        shortHash,
        author,
        date,
        subject,
        filesChanged: statMatch ? parseInt(statMatch[1], 10) : 0,
        insertions: statMatch && statMatch[2] ? parseInt(statMatch[2], 10) : 0,
        deletions: statMatch && statMatch[3] ? parseInt(statMatch[3], 10) : 0,
      };
    });

  res.json({ commits });
});

export default router;
