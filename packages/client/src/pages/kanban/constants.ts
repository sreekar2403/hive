import type { TaskStatus } from "./types";

type Tone = "neutral" | "accent" | "ok" | "info" | "warn" | "danger";

export interface ColumnDef {
  id: TaskStatus;
  title: string;
  /** One line explaining what belongs here, shown on the column header. */
  blurb: string;
  tone: Tone;
  /** When a column's task count exceeds this, its header flags overloaded. */
  wipLimit?: number;
  /**
   * Columns that are usually empty and only matter when they aren't.
   * The board can start them collapsed so eight columns still fit.
   */
  minorByDefault?: boolean;
}

/*
  The board reads left to right as the life of a piece of work: not yet
  committed to, committed to, being done, being checked, stuck, finished.
  `blocked` sits after the checking stages rather than at the end because
  that is where work actually gets stuck.
*/
export const COLUMNS: ColumnDef[] = [
  {
    id: "backlog",
    title: "Backlog",
    blurb: "Captured, not committed to",
    tone: "neutral",
    minorByDefault: true,
  },
  {
    id: "queued",
    title: "Queued",
    blurb: "Ready for an agent to pick up",
    tone: "neutral",
  },
  {
    id: "in_progress",
    title: "In progress",
    blurb: "An agent is working on it",
    tone: "accent",
    wipLimit: 3,
  },
  {
    id: "review",
    title: "In review",
    blurb: "Waiting on a human to read the diff",
    tone: "warn",
    wipLimit: 4,
  },
  {
    id: "testing",
    title: "Testing",
    blurb: "Changes in, checks running",
    tone: "info",
    wipLimit: 4,
  },
  {
    id: "blocked",
    title: "Blocked",
    blurb: "Stuck on something outside the task",
    tone: "danger",
  },
  { id: "done", title: "Done", blurb: "Finished and accepted", tone: "ok" },
  {
    id: "failed",
    title: "Failed",
    blurb: "Gave up or errored out",
    tone: "danger",
    minorByDefault: true,
  },
];

export const COLUMNS_BY_ID: Record<TaskStatus, ColumnDef> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c]),
) as Record<TaskStatus, ColumnDef>;

export const STATUS_LABEL: Record<TaskStatus, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.title]),
) as Record<TaskStatus, string>;

export const STATUS_TONE: Record<TaskStatus, Tone> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.tone]),
) as Record<TaskStatus, Tone>;

/** Terminal columns are collapsed into a single filter in the toolbar. */
export const TERMINAL_STATUSES: TaskStatus[] = ["done", "failed"];

export interface HarnessDef {
  id: string;
  label: string;
  /** CSS var from src/index.css holding this harness's identity colour. */
  cssVar: string;
}

/** Matches the harness ids the server actually registers (index.ts). */
export const HARNESSES: HarnessDef[] = [
  { id: "opencode", label: "opencode", cssVar: "--hive-agent-opencode" },
  { id: "claude-code", label: "claude-code", cssVar: "--hive-agent-claude" },
  { id: "pi", label: "pi", cssVar: "--hive-agent-pi" },
];

export function harnessColorVar(harness: string | null): string {
  return HARNESSES.find((h) => h.id === harness)?.cssVar ?? "--hive-agent-hive";
}

export function harnessLabel(harness: string | null): string {
  if (!harness) return "Unassigned";
  return HARNESSES.find((h) => h.id === harness)?.label ?? harness;
}
