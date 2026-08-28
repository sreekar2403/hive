/**
 * Turns the server's `agent:activity` SSE stream into floor visuals.
 *
 * The orchestrator already broadcasts every normalized HarnessEvent
 * (see packages/server/src/orchestrator.ts's onEvent); this module is the
 * Office's lens over it: a pure mapper plus a small store that routes
 * events to agents by taskId via the latest roster snapshot.
 */

/**
 * Structural subset of @hive/shared/harness's HarnessEvent. The client
 * package has no workspace path alias into shared, so the shape is pinned
 * here; packages/server/src/orchestrator.ts broadcasts the real thing.
 */
export interface HarnessEventLike {
  type:
    "status" | "text" | "thinking" | "tool" | "tool-result" | "usage" | "error";
  text?: string;
  tool?: string;
  callId?: string;
  detail?: string;
  status?: "running" | "completed" | "failed";
  at: number;
}

export interface FloorVisual {
  kind: "tool" | "thinking" | "error" | "output";
  /** Tool glyph or empty for non-tool kinds. */
  icon?: string;
  label?: string;
}

const TOOL_ICON: Record<string, string> = {
  Read: "<",
  Edit: ">",
  Write: ">",
  Bash: "$",
  Grep: "?",
  Glob: "?",
  WebFetch: "@",
  WebSearch: "@",
  TodoWrite: "=",
};

const DEFAULT_ICON = "*";

/** Pure HarnessEvent â†’ visual mapping. Returns null for invisible events. */
export function mapHarnessEvent(e: HarnessEventLike): FloorVisual | null {
  switch (e.type) {
    case "tool": {
      if (e.status === "completed" || e.status === "failed") return null;
      const icon = TOOL_ICON[e.tool ?? ""] ?? DEFAULT_ICON;
      const label = (e.detail ?? e.tool ?? "").trim() || DEFAULT_ICON;
      return { kind: "tool", icon, label };
    }
    case "thinking":
      return { kind: "thinking" };
    case "error": {
      const text = (e.text ?? "").trim();
      if (!text) return null;
      return { kind: "error", label: clip(text, 42) };
    }
    case "text": {
      const last = lastLine(e.text ?? "");
      if (!last) return null;
      return { kind: "output", label: clip(last, 42) };
    }
    default:
      // usage / status / tool-result never surface on the floor
      return null;
  }
}

function lastLine(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

type Subscriber = (agentId: string, visual: FloorVisual | null) => void;

interface ActivityPayload {
  taskId?: unknown;
  event?: unknown;
}

interface RosterEntry {
  id: string;
  taskId: string | null;
}

/**
 * Routes `agent:activity` payloads to agent ids using the most recent
 * roster snapshot, and exposes per-agent current visuals for the page tick.
 */
export class LiveActivityStore {
  private readonly subs = new Set<Subscriber>();
  private taskToAgent = new Map<string, string>();
  private currentByAgent = new Map<string, FloorVisual>();

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** Re-points taskIdâ†’agentId routing; clears visuals for departed tasks. */
  handleRoster(agents: RosterEntry[]): void {
    const next = new Map<string, string>();
    for (const a of agents) {
      if (a.taskId) next.set(a.taskId, a.id);
    }
    this.taskToAgent = next;

    const liveAgents = new Set(agents.map((a) => a.id));
    for (const id of [...this.currentByAgent.keys()]) {
      if (!liveAgents.has(id)) this.currentByAgent.delete(id);
    }
    // Agents whose task disappeared lose their visual immediately.
    for (const a of agents) {
      if (!a.taskId) this.currentByAgent.delete(a.id);
    }
  }

  ingest(sseType: string, data: unknown): void {
    if (sseType !== "agent:activity") return;
    if (typeof data !== "object" || data === null) return;
    const { taskId, event } = data as ActivityPayload;
    if (typeof taskId !== "string") return;
    if (typeof event !== "object" || event === null) return;

    const visual = mapHarnessEvent(event as HarnessEventLike);
    const agentId = this.taskToAgent.get(taskId);
    if (!agentId) return; // nobody on the roster owns this task yet

    if (visual) this.currentByAgent.set(agentId, visual);
    for (const fn of this.subs) fn(agentId, visual);
  }

  current(agentId: string): FloorVisual | null {
    return this.currentByAgent.get(agentId) ?? null;
  }

  /** Reverse lookup so task-level SSE events can find their character. */
  agentForTask(taskId: string): string | null {
    return this.taskToAgent.get(taskId) ?? null;
  }
}
