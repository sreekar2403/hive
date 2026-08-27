import type { HarnessEvent } from "@hive/shared/harness";
import type { PermissionManager } from "./permissions";

/**
 * Watches a harness's live tool-call stream and stops the run when the
 * agent reaches for a destructive shell command.
 *
 * This exists because the approval gate used to read the wrong input. It
 * scanned the user's *prompt* for destructive keywords, once, before the
 * agent started — so "reset the onboarding copy" was blocked while "fix the
 * failing test" sailed through and left the agent free to run `git reset
 * --hard` on its own initiative. Prompts describe intent; only the tool
 * stream shows what actually ran, and the harness parsers already produce
 * it (eventStream.ts) for the Logs screen.
 *
 * The gate is necessarily a halt rather than a pre-approval: the CLI is a
 * subprocess that has already decided to run the command by the time the
 * event reaches us. So the guard aborts the run at the first destructive
 * command and hands the decision to a human, who can approve a re-run with
 * that command allowed. Stopping mid-run is not free — the working tree may
 * be half-edited — but the worktree isolation in branches.ts is what keeps
 * that contained.
 */

/** Tool names, across CLIs, that mean "this is a shell command". */
const SHELL_TOOLS = new Set([
  "bash",
  "shell",
  "exec",
  "execute",
  "run",
  "run_command",
  "runcommand",
  "terminal",
  "command",
  "process",
  "sh",
  "powershell",
]);

export interface GuardTrip {
  /** The command as the agent invoked it. */
  command: string;
  /** Which configured destructive patterns it matched. */
  patterns: string[];
  tool: string;
}

export function isShellTool(tool: string | undefined): boolean {
  if (!tool) return false;
  return SHELL_TOOLS.has(tool.toLowerCase().replace(/[\s-]/g, "_"));
}

/**
 * Pulls the command out of a tool event's `detail`.
 *
 * Parsers hand us either a bare command string (Codex joins argv) or a
 * flattened JSON blob of the tool input (Claude Code's Bash tool). Both
 * shapes appear in eventStream.test.ts's captured fixtures.
 */
export function commandFromDetail(detail: string | undefined): string {
  if (!detail) return "";
  const text = detail.trim();
  if (!text.startsWith("{")) return text;

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["command", "cmd", "script", "input"]) {
      const value = parsed[key];
      if (typeof value === "string" && value) return value;
    }
  } catch {
    // Truncated JSON (details are capped) — fall through and scan the raw
    // text, which still contains the command verbatim.
  }
  return text;
}

export class RuntimeGuard {
  private readonly allowed: Set<string>;
  private trip: GuardTrip | null = null;

  constructor(
    private readonly permissions: PermissionManager,
    /** Commands a human already approved for this task's re-run. */
    allowed: Iterable<string> = [],
  ) {
    this.allowed = new Set(allowed);
  }

  /**
   * Returns the trip if this event is a destructive shell command that has
   * not already been approved, else null. Only the first trip is kept — the
   * run is being torn down after it, and later events are noise.
   */
  inspect(event: HarnessEvent): GuardTrip | null {
    if (this.trip) return null;
    if (event.type !== "tool" || !isShellTool(event.tool)) return null;

    const command = commandFromDetail(event.detail);
    if (!command || this.allowed.has(command)) return null;

    const patterns = this.permissions.matchDestructive(command);
    if (patterns.length === 0) return null;

    this.trip = { command, patterns, tool: event.tool ?? "shell" };
    return this.trip;
  }

  tripped(): GuardTrip | null {
    return this.trip;
  }
}
