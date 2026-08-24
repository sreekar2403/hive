import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { getDb } from "../db/database";
import { broadcast } from "./events";

/**
 * Kanban task board — owned by the "kanban" workstream.
 *
 * The live Orchestrator (packages/server/src/orchestrator.ts) keeps its
 * AgentTask map in-memory, private to the single HiveServer instance, and
 * has no project concept at all (no projectId on a task, execution always
 * runs against the server's own process.cwd()). That instance isn't
 * reachable from a route module without wiring a setter through
 * server.ts's start() method, which is off-limits here (other agents are
 * editing server.ts in parallel and the brief caps that edit at one
 * import + one mount line). So this board is backed by its own persisted
 * table instead of a read-through view of the Orchestrator — real SQLite
 * rows, real CRUD, project-scoped, not an in-memory mock array. See the
 * Kanban page-level report for the full tradeoff.
 */

const router: Router = Router();

/**
 * The board's columns, in pipeline order.
 *
 * `backlog` and `queued` are both pre-start: nothing has been picked up
 * yet, which is why neither stamps `started_at`. `review`, `testing` and
 * `blocked` are all mid-flight — work exists, but it isn't finished — and
 * only `done` and `failed` are terminal.
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

const STATUSES: TaskStatus[] = [
  "backlog",
  "queued",
  "in_progress",
  "review",
  "testing",
  "blocked",
  "done",
  "failed",
];

/** Statuses that mean "not picked up yet" — see started_at below. */
const PRE_START: TaskStatus[] = ["backlog", "queued"];
const TERMINAL: TaskStatus[] = ["done", "failed"];

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

let ensured = false;

/** Idempotent — see the module comment for why this table is self-owned. */
function ensureTable(): void {
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
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kanban_tasks_project ON kanban_tasks (project_id)`,
  );
  ensured = true;
}

function eventForStatus(status: TaskStatus): string {
  if (status === "done") return "task:completed";
  if (status === "failed") return "task:failed";
  if (status === "in_progress") return "task:started";
  return "task:progress";
}

// GET /api/tasks?projectId=&status=&harness=
router.get("/", (req: Request, res: Response) => {
  ensureTable();
  const db = getDb();
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (!projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  const clauses = ["project_id = ?"];
  const params: unknown[] = [projectId];

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }

  const harness = typeof req.query.harness === "string" ? req.query.harness : undefined;
  if (harness) {
    clauses.push("harness = ?");
    params.push(harness);
  }

  const rows = db
    .prepare(
      `SELECT * FROM kanban_tasks WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
    )
    .all(...params) as KanbanTask[];

  res.json({ tasks: rows, total: rows.length });
});

// GET /api/tasks/:id
router.get("/:id", (req: Request, res: Response) => {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT * FROM kanban_tasks WHERE id = ?").get(req.params.id) as
    | KanbanTask
    | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// POST /api/tasks
router.post("/", (req: Request, res: Response) => {
  ensureTable();
  const { projectId, prompt, harness, status } = req.body ?? {};

  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: "projectId is required" });
  }
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "A task prompt is required" });
  }
  // A task can be created straight into a column — the board's per-column
  // "add" affordance would otherwise need a create followed by a move.
  if (status !== undefined && !STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of ${STATUSES.join(", ")}` });
  }

  const db = getDb();
  const now = Date.now();
  const task: KanbanTask = {
    id: randomUUID(),
    project_id: projectId,
    prompt: prompt.trim(),
    harness: typeof harness === "string" && harness ? harness : null,
    status: (status as TaskStatus) ?? "queued",
    branch_name: null,
    iterations: 0,
    files_changed: 0,
    output: null,
    error: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };
  if (!PRE_START.includes(task.status)) task.started_at = now;
  if (TERMINAL.includes(task.status)) task.completed_at = now;
  task.branch_name = `hive/${task.project_id}/${task.id}`;

  db.prepare(
    `INSERT INTO kanban_tasks
      (id, project_id, prompt, harness, status, branch_name, iterations, files_changed, output, error, started_at, completed_at, created_at, updated_at)
     VALUES (@id, @project_id, @prompt, @harness, @status, @branch_name, @iterations, @files_changed, @output, @error, @started_at, @completed_at, @created_at, @updated_at)`,
  ).run(task);

  broadcast("task:progress", { taskId: task.id, projectId: task.project_id, status: task.status });
  res.status(201).json(task);
});

// PUT /api/tasks/:id — partial update (matches the PUT-as-patch convention
// already used by /api/projects/:id and /api/schedules/:id in this codebase,
// so the client can update through the existing API.put helper).
router.put("/:id", (req: Request, res: Response) => {
  ensureTable();
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM kanban_tasks WHERE id = ?")
    .get(req.params.id) as KanbanTask | undefined;
  if (!existing) return res.status(404).json({ error: "Not found" });

  const body = req.body ?? {};

  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(", ")}` });
  }

  const next: KanbanTask = {
    ...existing,
    prompt: typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : existing.prompt,
    harness: body.harness === null ? null : typeof body.harness === "string" ? body.harness : existing.harness,
    status: body.status ?? existing.status,
    iterations: Number.isFinite(body.iterations) ? Math.max(0, body.iterations) : existing.iterations,
    files_changed: Number.isFinite(body.files_changed)
      ? Math.max(0, body.files_changed)
      : existing.files_changed,
    output: typeof body.output === "string" ? body.output : existing.output,
    error: typeof body.error === "string" ? body.error : existing.error,
    updated_at: Date.now(),
  };

  // Keep started_at/completed_at honest against the status timeline rather
  // than trusting the client to send them.
  if (!PRE_START.includes(next.status) && existing.started_at === null) {
    next.started_at = next.updated_at;
  }
  if (TERMINAL.includes(next.status)) {
    if (existing.completed_at === null || existing.status !== next.status) {
      next.completed_at = next.updated_at;
    }
  } else {
    next.completed_at = null;
  }

  db.prepare(
    `UPDATE kanban_tasks SET
       prompt = @prompt, harness = @harness, status = @status,
       iterations = @iterations, files_changed = @files_changed,
       output = @output, error = @error,
       started_at = @started_at, completed_at = @completed_at, updated_at = @updated_at
     WHERE id = @id`,
  ).run(next);

  if (next.status !== existing.status) {
    broadcast(eventForStatus(next.status), {
      taskId: next.id,
      projectId: next.project_id,
      status: next.status,
    });
  } else {
    broadcast("task:progress", { taskId: next.id, projectId: next.project_id, status: next.status });
  }

  res.json(next);
});

// DELETE /api/tasks/:id
router.delete("/:id", (req: Request, res: Response) => {
  ensureTable();
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM kanban_tasks WHERE id = ?")
    .get(req.params.id) as KanbanTask | undefined;
  if (!existing) return res.status(404).json({ error: "Not found" });

  db.prepare("DELETE FROM kanban_tasks WHERE id = ?").run(req.params.id);
  broadcast("task:progress", { taskId: existing.id, projectId: existing.project_id, status: "deleted" });
  res.status(204).end();
});

export default router;
