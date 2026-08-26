/**
 * Mirrors TaskStatus in packages/server/src/routes/tasks.ts. The two lists
 * must stay in step: the server rejects a status it doesn't recognise, so
 * a column added here without adding it there fails on the first drag.
 */
export type TaskStatus =
  | "backlog"
  | "queued"
  | "in_progress"
  | "review"
  | "testing"
  | "blocked"
  | "done"
  | "failed";

/**
 * Mirrors the row shape returned by GET/POST/PUT /api/tasks on the server
 * (packages/server/src/routes/tasks.ts). Field names stay snake_case to
 * match that response verbatim, same convention as Project/Schedule.
 */
export interface KanbanTask {
  id: string;
  project_id: string;
  prompt: string;
  harness: string | null;
  status: TaskStatus;
  branch_name: string | null;
  /** The orchestrator run behind this card, when one produced it. */
  run_task_id?: string | null;
  /** The chat conversation it came from, when it came from chat. */
  session_id?: string | null;
  model?: string | null;
  /** JSON array of repo-relative paths, as stored. Use TaskDetail.files. */
  files?: string | null;
  iterations: number;
  files_changed: number;
  output: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Response of GET /api/tasks/:id/detail — the board's task view. */
export interface TaskDetailPayload {
  task: KanbanTask;
  files: string[];
  spans: Array<{
    id: string;
    task_id: string;
    parent_id: string | null;
    name: string;
    type: string;
    started_at: number;
    ended_at: number | null;
    outcome: "ok" | "failed" | "skipped" | null;
    detail: string | null;
  }>;
  logs: Array<{
    id: string;
    ts: number;
    level: string;
    source: string;
    message: string;
  }>;
  timeline: Array<{ at: number; label: string }>;
}
