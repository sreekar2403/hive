import { randomUUID } from "crypto";
import { getDb } from "./db/database";

/**
 * The kanban board's table and the two writes that are not CRUD.
 *
 * This exists because a card is now created from two places. A chat message
 * makes one (server.ts), and a fan-out makes one per sub-agent
 * (orchestrator.ts) — sub-agents are real runs with their own branch,
 * worktree, files and outcome, and a board that showed one card for a
 * four-agent request was hiding exactly the part worth looking at.
 *
 * Two callers writing the same table with two copies of the same INSERT is
 * how column sets drift, so the statement lives here once and the routes
 * own only the board's CRUD.
 */

/** Cards a run can be in. Mirrors routes/tasks.ts, which owns the board. */
export type KanbanStatus =
  | "backlog"
  | "queued"
  | "in_progress"
  | "review"
  | "testing"
  | "blocked"
  | "done"
  | "failed";

let ensured = false;

/** Idempotent; safe to call on every write. */
export function ensureKanbanTable(): void {
  if (ensured) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS kanban_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      harness TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      branch_name TEXT,
      run_task_id TEXT,
      session_id TEXT,
      model TEXT,
      files TEXT,
      iterations INTEGER NOT NULL DEFAULT 0,
      files_changed INTEGER NOT NULL DEFAULT 0,
      output TEXT,
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Boards predating a feature keep working; each column is added once.
  const columns = db.prepare("PRAGMA table_info(kanban_tasks)").all() as Array<{
    name: string;
  }>;
  for (const [name, decl] of [
    ["run_task_id", "TEXT"],
    ["session_id", "TEXT"],
    ["model", "TEXT"],
    ["files", "TEXT"],
    // The card this one was split out of. Null for an ordinary request,
    // which is every card that existed before fan-out.
    ["parent_id", "TEXT"],
    // A sub-agent's prompt is its full briefing — its own instruction plus
    // what its siblings are doing plus the original request. Correct to
    // run, unreadable on a card, so the planner's short label rides along.
    ["title", "TEXT"],
  ] as const) {
    if (!columns.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE kanban_tasks ADD COLUMN ${name} ${decl}`);
    }
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kanban_tasks_project ON kanban_tasks (project_id)`,
  );
  // The board fetches a request's sub-cards by parent on every render.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kanban_tasks_parent ON kanban_tasks (parent_id)`,
  );
  ensured = true;
}

export interface NewKanbanCard {
  projectId: string;
  prompt: string;
  harness: string | null;
  runTaskId: string | null;
  sessionId: string | null;
  model: string | null;
  branchName: string | null;
  status?: KanbanStatus;
  /** Short label; the card shows this instead of a long briefing. */
  title?: string | null;
  /** The request this was split out of, for a fan-out sub-agent. */
  parentId?: string | null;
}

/** Opens a card and returns its id. */
export function createKanbanCard(card: NewKanbanCard): string {
  ensureKanbanTable();
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO kanban_tasks
      (id, project_id, prompt, title, parent_id, harness, status, branch_name,
       run_task_id, session_id, model, files, iterations, files_changed,
       output, error, started_at, completed_at, created_at, updated_at)
     VALUES (@id, @project_id, @prompt, @title, @parent_id, @harness, @status,
       @branch_name, @run_task_id, @session_id, @model, @files, @iterations,
       @files_changed, @output, @error, @started_at, @completed_at,
       @created_at, @updated_at)`,
  ).run({
    id,
    project_id: card.projectId,
    prompt: card.prompt.trim(),
    title: card.title ?? null,
    parent_id: card.parentId ?? null,
    harness: card.harness,
    status: card.status ?? "in_progress",
    branch_name: card.branchName,
    run_task_id: card.runTaskId,
    session_id: card.sessionId,
    model: card.model,
    files: null,
    iterations: 0,
    files_changed: 0,
    output: null,
    error: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
  });

  return id;
}

export interface KanbanOutcome {
  status: KanbanStatus;
  iterations?: number;
  files?: string[];
  output?: string | null;
  error?: string | null;
  branchName?: string | null;
}

/** Closes a card with what the run actually produced. */
export function finishKanbanCard(id: string, outcome: KanbanOutcome): void {
  ensureKanbanTable();
  const db = getDb();
  const now = Date.now();
  const files = outcome.files ?? [];

  db.prepare(
    `UPDATE kanban_tasks SET
       status = @status,
       iterations = @iterations,
       files_changed = @files_changed,
       files = @files,
       output = @output,
       error = @error,
       branch_name = COALESCE(@branch_name, branch_name),
       completed_at = @completed_at,
       updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id,
    status: outcome.status,
    iterations: outcome.iterations ?? 0,
    files_changed: files.length,
    files: JSON.stringify(files),
    output: outcome.output ?? null,
    error: outcome.error ?? null,
    branch_name: outcome.branchName ?? null,
    completed_at: now,
    updated_at: now,
  });
}
