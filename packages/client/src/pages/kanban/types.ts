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
  iterations: number;
  files_changed: number;
  output: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}
