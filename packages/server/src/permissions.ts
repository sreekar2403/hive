import { Config } from "./config";
import { broadcast } from "./routes/events";

/** Best-effort SSE push so the Office floor reacts instantly; polling in
 *  the client remains the correctness net if the stream ever drops. */
function broadcastSafe(event: string, data: unknown): void {
  try {
    broadcast(event, data);
  } catch {
    // Observation only — permission flow must never depend on it.
  }
}

/** Cache of compiled pattern matchers — the config list is stable and
 *  isDestructive() runs on every task. */
const patternCache = new Map<string, RegExp>();

/**
 * Whether the pattern occurs anywhere outside a path or ref segment.
 *
 * The cached regex cannot be reused with the global flag directly —
 * lastIndex state would leak between calls — so each check runs on a
 * fresh global clone. Matches are non-empty (the escaped pattern is a
 * non-empty literal), so the scan always advances.
 */
function matchesOutsidePaths(pattern: RegExp, action: string): boolean {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const search = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = search.exec(action)) !== null) {
    const prev = match.index > 0 ? action[match.index - 1] : "";
    if (prev !== "/" && prev !== "\\") return true;
  }
  return false;
}

/**
 * Blanks out `"..."` and `'...'` spans (backslash escapes honoured, an
 * unterminated quote swallows the rest) so patterns are matched against
 * the command's verbs and flags, not its free-text arguments.
 *
 * A PR titled "cleanup: remove repeated intros" or a commit message
 * saying the same halted `gh pr create` / `git commit` — the verbs are
 * harmless and "remove" there is English prose, not an action. Verbs
 * and flags are virtually never quoted (quoting them is pointless), so
 * the accepted trade is a quoted verb escaping the gate
 * (`powershell -Command "Remove-Item …"`), which is far rarer than
 * prose tripping it. A blank keeps token separation so stripping never
 * glues neighbouring words into a false match.
 */
function stripQuotedSpans(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '"' && ch !== "'") {
      out += ch;
      i++;
      continue;
    }
    const quote = ch;
    i++;
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\\" && i + 1 < text.length) i++;
      i++;
    }
    i++; // consume the closing quote, or run off a truncated end
    out += " ";
  }
  return out;
}

function destructivePattern(pattern: string): RegExp {
  const cached = patternCache.get(pattern);
  if (cached) return cached;

  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leading = /^\w/.test(pattern) ? "\\b" : "";
  const trailing = /\w$/.test(pattern) ? "\\b" : "";
  const re = new RegExp(`${leading}${escaped}${trailing}`, "i");
  patternCache.set(pattern, re);
  return re;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  action: string;
  description: string;
  command?: string;
  files?: string[];
  timestamp: number;
  approved: boolean | null;
  timeoutAt: number;
  denyReason?: string;
}

export class PermissionManager {
  private config: Config;
  private pending: Map<string, PermissionRequest>;
  private resolvers: Map<string, (approved: boolean) => void>;

  constructor(config: Config) {
    this.config = config;
    this.pending = new Map();
    this.resolvers = new Map();
  }

  async checkPermission(
    sessionId: string,
    action: string,
    description: string,
    command?: string,
    files?: string[],
  ): Promise<boolean> {
    if (!this.config.permission.enabled) return true;

    // Check if this is a destructive action
    if (!this.isDestructive(action)) return true;

    // Create permission request
    const request: PermissionRequest = {
      id: this.generateId(),
      sessionId,
      action,
      description,
      command,
      files,
      timestamp: Date.now(),
      approved: null,
      timeoutAt: Date.now() + this.config.permission.timeout,
    };

    this.pending.set(request.id, request);
    broadcastSafe("permission:request", request);

    // Wait for approve()/deny() to settle this request, or time out.
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.resolvers.delete(request.id);
        this.pending.delete(request.id);
        resolve(false);
      }, this.config.permission.timeout);

      this.resolvers.set(request.id, (approved: boolean) => {
        clearTimeout(timeout);
        this.resolvers.delete(request.id);
        resolve(approved);
      });
    });
  }

  approve(requestId: string): boolean {
    const request = this.pending.get(requestId);
    if (!request) return false;

    request.approved = true;
    this.pending.delete(requestId);
    broadcastSafe("permission:resolved", { ...request, approved: true });
    this.resolvers.get(requestId)?.(true);
    return true;
  }

  deny(requestId: string, reason?: string): boolean {
    const request = this.pending.get(requestId);
    if (!request) return false;

    request.approved = false;
    request.denyReason = reason;
    console.log(
      `[permissions] Denied ${requestId} (session ${request.sessionId})${reason ? `: ${reason}` : ""}`,
    );
    this.pending.delete(requestId);
    broadcastSafe("permission:resolved", { ...request, approved: false });
    this.resolvers.get(requestId)?.(false);
    return true;
  }

  getPending(sessionId?: string): PermissionRequest[] {
    const all = Array.from(this.pending.values());
    if (!sessionId) return all;
    return all.filter((r) => r.sessionId === sessionId);
  }

  isDestructive(action: string): boolean {
    return this.matchDestructive(action).length > 0;
  }

  /** Which configured patterns this text trips, as whole words.
   *
   *  Plain substring matching made short patterns catastrophically
   *  greedy: "rm" fired on "confirm", "platform" and "perform", so
   *  everyday prompts stalled on the approval gate. Each pattern is
   *  compiled to a regex whose edges only assert a word boundary where
   *  the pattern itself ends in a word character, so flag-shaped
   *  patterns ("push --force", "push -f") still match the way an
   *  operator wrote them.
   *
   *  Occurrences preceded by "/" or "\" are additionally ignored: those
   *  sit inside a path or ref segment (branches like
   *  `cleanup/remove-repeated-intro`, Windows paths), not in the
   *  command's own verbs and flags. Without this, one branch name halted
   *  every git command in the task until the guard budget ran out. */
  matchDestructive(action: string): string[] {
    const bare = stripQuotedSpans(action);
    return this.config.permission.destructiveActions.filter((pattern) =>
      matchesOutsidePaths(destructivePattern(pattern), bare),
    );
  }

  private generateId(): string {
    return `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
