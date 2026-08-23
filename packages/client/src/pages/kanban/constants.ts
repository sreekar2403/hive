import type { TaskStatus } from "./types";

export interface ColumnDef {
  id: TaskStatus;
  title: string;
  /** When a column's task count exceeds this, its header flags overloaded. */
  wipLimit?: number;
}

export const COLUMNS: ColumnDef[] = [
  { id: "queued", title: "Queued" },
  { id: "in_progress", title: "In progress", wipLimit: 3 },
  { id: "review", title: "Review", wipLimit: 4 },
  { id: "done", title: "Done" },
  { id: "failed", title: "Failed" },
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  failed: "Failed",
};

type Tone = "neutral" | "accent" | "ok" | "info" | "warn" | "danger";

export const STATUS_TONE: Record<TaskStatus, Tone> = {
  queued: "neutral",
  in_progress: "accent",
  review: "warn",
  done: "ok",
  failed: "danger",
};

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
