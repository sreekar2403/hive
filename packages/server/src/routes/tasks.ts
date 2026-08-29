import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { getDb } from "../db/database";
import { ensureKanbanTable } from "../kanban";
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
  /** The orchestrator run that produced this card, when one did. */
  run_task_id: string | null;
  /** The chat conversation the card came from, when it came from chat. */
  session_id: string | null;
  model: string | null;
  /** JSON array of repo-relative paths the run touched. */
  files: string | null;
  /** Short label; a sub-agent's prompt is a briefing, not a card title. */
  title: string | null;
  /** The request this card was split out of, for a fan-out sub-agent. */
  parent_id: string | null;
  iterations: number;
  files_changed: number;
  output: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * The table is owned by kanban.ts, which both this board and the
 * orchestrator write to — see its comment for why a fan-out's sub-agents
 * each need a card of their own.
 */
function ensureTable(): void {
  ensureKanbanTable();
}

function eventForStatus(status: TaskStatus): string {
  if (status === "done") return "task:completed";
  if (status === "failed") return "task:failed";
  if (status === "in_progress") return "task:started";
  return "task:progress";
}

// GET /api/tasks?projectId=&status=&harness=&limit=&offset=
router.get("/", (req: Request, res: Response) => {
  ensureTable();
  const db = getDb();
  const projectId =
    typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (!projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  const clauses = ["project_id = ?"];
  const params: unknown[] = [projectId];

  const status =
    typeof req.query.status === "string" ? req.query.status : undefined;
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }

  const harness =
    typeof req.query.harness === "string" ? req.query.harness : undefined;
  if (harness) {
    clauses.push("harness = ?");
    params.push(harness);
  }

  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.floor(rawLimit)), 100)
    : 50;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.floor(rawOffset))
    : 0;
  const where = clauses.join(" AND ");

  const totalRow = db
    .prepare(`SELECT COUNT(*) as c FROM kanban_tasks WHERE ${where}`)
    .get(...params) as { c: number };
  const total = totalRow?.c ?? 0;

  const rows = db
    .prepare(
      `SELECT * FROM kanban_tasks WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as KanbanTask[];

  res.json({ tasks: rows, total, limit, offset });
});

// GET /api/tasks/:id
router.get("/:id", (req: Request, res: Response) => {
  ensureTable();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM kanban_tasks WHERE id = ?")
    .get(req.params.id) as KanbanTask | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

/*
 * GET /api/tasks/:id/detail — everything the board's task view shows.
 *
 * A card is the visible end of a run: the prompt that started it, the
 * files it touched, the trace it left and the conversation it came from.
 * Assembling that here keeps the client to one request instead of four,
 * and lets a card with no run behind it degrade to just the card.
 */
router.get("/:id/detail", (req: Request, res: Response) => {
  ensureTable();
  const db = getDb();
  const task = db
    .prepare("SELECT * FROM kanban_tasks WHERE id = ?")
    .get(req.params.id) as KanbanTask | undefined;
  if (!task) return res.status(404).json({ error: "Not found" });

  let files: string[] = [];
  try {
    const parsed = task.files ? JSON.parse(task.files) : [];
    if (Array.isArray(parsed))
      files = parsed.filter((f) => typeof f === "string");
  } catch {
    files = [];
  }

  // Spans and logs are written lazily, so their tables may not exist yet on
  // a board whose first task has not run.
  let spans: unknown[] = [];
  let logs: unknown[] = [];
  if (task.run_task_id) {
    try {
      spans = db
        .prepare(
          "SELECT * FROM spans WHERE task_id = ? ORDER BY started_at ASC LIMIT 500",
        )
        .all(task.run_task_id);
    } catch {
      spans = [];
    }
    try {
      logs = db
        .prepare(
          "SELECT * FROM logs WHERE task_id = ? ORDER BY ts ASC LIMIT 200",
        )
        .all(task.run_task_id);
    } catch {
      logs = [];
    }
  }

  // The card's own history, which is what a status column actually records.
  const timeline: Array<{ at: number; label: string }> = [
    { at: task.created_at, label: "Created" },
  ];
  if (task.started_at) timeline.push({ at: task.started_at, label: "Started" });
  if (task.completed_at) {
    timeline.push({
      at: task.completed_at,
      label: task.status === "failed" ? "Failed" : "Completed",
    });
  }

  res.json({ task, files, spans, logs, timeline });
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
    // A hand-added card is its own title, and belongs to no request.
    title: null,
    parent_id: null,
    harness: typeof harness === "string" && harness ? harness : null,
    status: (status as TaskStatus) ?? "queued",
    branch_name: null,
    // A card added by hand has no run behind it until one picks it up.
    run_task_id: null,
    session_id: null,
    model: null,
    files: null,
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
      (id, project_id, prompt, title, parent_id, harness, status, branch_name, run_task_id, session_id, model, files, iterations, files_changed, output, error, started_at, completed_at, created_at, updated_at)
     VALUES (@id, @project_id, @prompt, @title, @parent_id, @harness, @status, @branch_name, @run_task_id, @session_id, @model, @files, @iterations, @files_changed, @output, @error, @started_at, @completed_at, @created_at, @updated_at)`,
  ).run(task);

  broadcast("task:progress", {
    taskId: task.id,
    projectId: task.project_id,
    status: task.status,
  });
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
    return res
      .status(400)
      .json({ error: `status must be one of ${STATUSES.join(", ")}` });
  }

  const next: KanbanTask = {
    ...existing,
    prompt:
      typeof body.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : existing.prompt,
    harness:
      body.harness === null
        ? null
        : typeof body.harness === "string"
          ? body.harness
          : existing.harness,
    status: body.status ?? existing.status,
    iterations: Number.isFinite(body.iterations)
      ? Math.max(0, body.iterations)
      : existing.iterations,
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
    broadcast("task:progress", {
      taskId: next.id,
      projectId: next.project_id,
      status: next.status,
    });
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
  broadcast("task:progress", {
    taskId: existing.id,
    projectId: existing.project_id,
    status: "deleted",
  });
  res.status(204).end();
});

export default router;
