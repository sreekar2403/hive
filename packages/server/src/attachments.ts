import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import type { HarnessAttachment } from "@hive/shared/harness";

/**
 * Files a person attached to a chat message, on their way to an agent.
 *
 * Stored outside the project, under the OS temp root rather than in the
 * repository. An attachment dropped into the working tree would show up in
 * `git status`, be picked up by `detectFilesChanged` as work the agent did,
 * and follow the branch into a merge — a screenshot of a bug is context for
 * the task, not a change to the codebase.
 *
 * Sub-agents each run in their own worktree, which is why every path handed
 * out here is absolute: a relative one would resolve to a different place
 * for each of them, or nowhere at all.
 */

export interface StoredAttachment extends HarnessAttachment {
  id: string;
  size: number;
  createdAt: number;
}

/** Refused past this, per file. Big enough for a screenshot or a spec. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Kept for this long, then reaped — see pruneAttachments(). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let rootDir: string | null = null;

export function attachmentRoot(): string {
  if (rootDir) return rootDir;
  const dir = path.join(os.tmpdir(), "hive-attachments");
  fs.mkdirSync(dir, { recursive: true });
  rootDir = dir;
  return dir;
}

/**
 * Strips everything but a plain filename.
 *
 * The name arrives from a browser and is used to build a path, so it is
 * treated as hostile: `../../.ssh/authorized_keys` must not become a write
 * outside the attachment directory. Directory separators and traversal go,
 * and anything left that is empty gets a generated name rather than
 * resolving to the directory itself.
 */
export function safeFileName(name: string): string {
  // Backslashes become slashes first, so a Windows-style path is reduced by
  // basename as well — on posix, basename("..\..\evil.dll") is the whole
  // string.
  const base = path
    .basename(name.replace(/\\/g, "/"))
    .replace(/[/\\]/g, "")
    // Leading dots would let ".." survive as a name, and hide the file.
    .replace(/^\.+/, "")
    // Characters Windows rejects in a filename. A literal space is legal
    // and ordinary and is kept: an earlier version wrote this class as
    // `[ -<>:"|?*]`, whose leading " -<" is a *range* from space to "<" —
    // it silently ate spaces, digits and dots out of every filename.
    .replace(/[<>:"|?*]/g, "")
    .trim()
    .slice(0, 120);
  return base || "attachment";
}

export interface IncomingAttachment {
  name: string;
  mimeType?: string;
  /** Base64, with or without a `data:…;base64,` prefix. */
  data: string;
}

/**
 * Writes one attachment to disk and describes where it landed.
 *
 * Base64 rather than multipart because the alternative was a new dependency
 * for a single endpoint, and because the two ways people actually attach a
 * screenshot — paste and drag — both hand the browser a Blob that is as
 * easy to base64 as to build a multipart body from.
 */
export function storeAttachment(
  incoming: IncomingAttachment,
): StoredAttachment {
  const base64 = incoming.data.includes(",")
    ? incoming.data.slice(incoming.data.indexOf(",") + 1)
    : incoming.data;

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) throw new Error("The attachment was empty.");
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `The attachment is ${Math.round(buffer.length / 1024 / 1024)} MB; the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`,
    );
  }

  const id = randomUUID();
  // One directory per attachment, so two files of the same name cannot
  // collide and the original name survives for the agent to read.
  const dir = path.join(attachmentRoot(), id);
  fs.mkdirSync(dir, { recursive: true });

  const name = safeFileName(incoming.name);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buffer);

  return {
    id,
    name,
    path: filePath,
    mimeType: incoming.mimeType ?? "",
    size: buffer.length,
    createdAt: Date.now(),
  };
}

/** Reads back a stored attachment, or null when it is gone. */
export function findAttachment(id: string): StoredAttachment | null {
  // The id is used as a path segment, so it has to be exactly a uuid and
  // not merely "starts with one".
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const dir = path.join(attachmentRoot(), id);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }

  const name = entries[0];
  if (!name) return null;

  const filePath = path.join(dir, name);
  const stat = fs.statSync(filePath);
  return {
    id,
    name,
    path: filePath,
    mimeType: guessMimeType(name),
    size: stat.size,
    createdAt: stat.mtimeMs,
  };
}

/** Resolves the ids a chat request sent, skipping any that have expired. */
export function resolveAttachments(ids: unknown): StoredAttachment[] {
  if (!Array.isArray(ids)) return [];
  const found: StoredAttachment[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const attachment = findAttachment(id);
    if (attachment) found.push(attachment);
  }
  return found;
}

/**
 * Deletes attachments older than a week.
 *
 * These live in temp and are never referenced again once their run is over,
 * but nothing else would ever remove them — a daily screenshot habit would
 * quietly fill a disk. Called at startup; failures are ignored because a
 * reaper that cannot delete is not a reason to refuse to boot.
 */
export function pruneAttachments(maxAgeMs = MAX_AGE_MS): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(attachmentRoot());
  } catch {
    return 0;
  }

  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    const dir = path.join(attachmentRoot(), entry);
    try {
      if (fs.statSync(dir).mtimeMs >= cutoff) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch {
      // A file held open by something else is not worth failing over.
    }
  }
  return removed;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

export function guessMimeType(name: string): string {
  return MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? "";
}

/** Tests need a root that isn't the real one. */
export function setAttachmentRootForTests(dir: string | null): void {
  rootDir = dir;
}
