export type ChangeType = "added" | "modified" | "deleted" | "renamed";

export interface GitFileEntry {
  path: string;
  oldPath?: string;
  changeType: ChangeType;
  added: number | null;
  removed: number | null;
  binary: boolean;
}

export interface GitStatus {
  projectId: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  clean: boolean;
}

export interface GitDiff {
  path: string;
  oldPath?: string;
  staged: boolean;
  changeType: ChangeType;
  binary: boolean;
  tooLarge: boolean;
  added: number;
  removed: number;
  /** Raw unified diff, starting at the first @@ hunk header. */
  patch: string;
}

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export type DiffLineKind = "add" | "remove" | "context" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Line number in the old file, null for added lines and hunk headers. */
  oldNo: number | null;
  /** Line number in the new file, null for removed lines and hunk headers. */
  newNo: number | null;
}

/**
 * Parses a unified diff into numbered lines. The server sends the patch
 * verbatim from `git diff`, so line numbers are derived here from each
 * `@@ -a,b +c,d @@` header rather than being transmitted per line.
 */
export function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldNo = parseInt(m[1], 10);
        newNo = parseInt(m[2], 10);
      }
      out.push({ kind: "hunk", text: raw, oldNo: null, newNo: null });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "remove", text: raw.slice(1), oldNo: oldNo++, newNo: null });
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file"
      out.push({ kind: "meta", text: raw, oldNo: null, newNo: null });
    } else {
      out.push({
        kind: "context",
        text: raw.startsWith(" ") ? raw.slice(1) : raw,
        oldNo: oldNo++,
        newNo: newNo++,
      });
    }
  }

  // Drop a trailing blank produced by the final newline.
  if (out.length && out[out.length - 1].text === "" && out[out.length - 1].kind === "context") {
    out.pop();
  }
  return out;
}

/** Middle-truncates a path so both the directory and filename stay readable. */
export function truncatePath(p: string, max = 46): string {
  if (p.length <= max) return p;
  const keep = Math.floor((max - 1) / 2);
  return `${p.slice(0, keep)}…${p.slice(p.length - keep)}`;
}

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

export const CHANGE_TYPE_TONE: Record<
  ChangeType,
  "ok" | "warn" | "danger" | "info"
> = {
  added: "ok",
  modified: "warn",
  deleted: "danger",
  renamed: "info",
};
