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
   *  operator wrote them. */
  matchDestructive(action: string): string[] {
    return this.config.permission.destructiveActions.filter((pattern) =>
      destructivePattern(pattern).test(action),
    );
  }

  private generateId(): string {
    return `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
