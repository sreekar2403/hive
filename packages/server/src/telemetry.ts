import { randomUUID } from "crypto";
import { getDb } from "./db/database";
import { broadcast } from "./routes/events";

/**
 * Structured logging and execution tracing.
 *
 * Logs are flat lines you can filter; spans form a tree describing one
 * task run — routing, permission check, each loop iteration, every harness
 * spawn and tool call — so the Logs screen can draw a waterfall of what
 * actually happened rather than a wall of text.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type SpanType =
  | "task"
  | "route"
  | "permission"
  | "iteration"
  | "harness"
  | "tool"
  | "git"
  // Second Brain recall — what the task was told about your past work
  // before it started. See secondBrain/.
  | "memory"
  | "result";

export type SpanOutcome = "ok" | "failed" | "skipped";

export interface LogRow {
  id: string;
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
  taskId: string | null;
  projectId: string | null;
  context: string | null;
}

export interface SpanRow {
  id: string;
  taskId: string;
  /** The chat conversation this run belongs to, when it came from one. */
  sessionId: string | null;
  parentId: string | null;
  name: string;
  type: SpanType;
  startedAt: number;
  endedAt: number | null;
  outcome: SpanOutcome | null;
  detail: string | null;
}

/** Keep the most recent runs only; this is a local dev tool, not an archive. */
const MAX_TRACED_TASKS = 200;
const MAX_LOGS = 5000;

let ready = false;

function ensureTables(): void {
  if (ready) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      task_id TEXT,
      project_id TEXT,
      context TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts DESC)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS spans (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      session_id TEXT,
      parent_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      outcome TEXT,
      detail TEXT
    )
  `);
  // Databases created before conversations were traced predate session_id.
  const columns = db.prepare("PRAGMA table_info(spans)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((c) => c.name === "session_id")) {
    db.exec("ALTER TABLE spans ADD COLUMN session_id TEXT");
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_spans_task ON spans (task_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_spans_session ON spans (session_id)`);
  ready = true;
}

/**
 * Which conversation each task belongs to.
 *
 * Spans are opened from a dozen call sites that know a task id and nothing
 * else. Rather than thread a session id through all of them, a task
 * announces its conversation once and every span it opens is stamped with
 * it — so the Logs screen can show one trace per conversation instead of
 * one per message.
 */
const taskSessions = new Map<string, string>();

export function registerTaskSession(taskId: string, sessionId: string): void {
  taskSessions.set(taskId, sessionId);
  // Bounded: this is a live-run index, not history. The database column is
  // the durable copy.
  if (taskSessions.size > 500) {
    const oldest = taskSessions.keys().next().value;
    if (oldest !== undefined) taskSessions.delete(oldest);
  }
}

export function sessionForTask(taskId: string): string | null {
  return taskSessions.get(taskId) ?? null;
}

function serialise(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    // Guard against a runaway stdout dump becoming a database row.
    return json.length > 8000 ? `${json.slice(0, 8000)}…"}` : json;
  } catch {
    return null;
  }
}

export function log(
  level: LogLevel,
  source: string,
  message: string,
  ctx?: {
    taskId?: string | null;
    projectId?: string | null;
    context?: unknown;
  },
): void {
  ensureTables();
  const row: LogRow = {
    id: randomUUID(),
    ts: Date.now(),
    level,
    source,
    message,
    taskId: ctx?.taskId ?? null,
    projectId: ctx?.projectId ?? null,
    context: serialise(ctx?.context),
  };

  getDb()
    .prepare(
      `INSERT INTO logs (id, ts, level, source, message, task_id, project_id, context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.ts,
      row.level,
      row.source,
      row.message,
      row.taskId,
      row.projectId,
      row.context,
    );

  broadcast("log", row);
  prune();
}

/** Opens a span. Returns its id so it can be closed and nested under. */
export function startSpan(
  taskId: string,
  name: string,
  type: SpanType,
  parentId: string | null = null,
  detail?: unknown,
): string {
  ensureTables();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO spans (id, task_id, session_id, parent_id, name, type, started_at, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      taskId,
      sessionForTask(taskId),
      parentId,
      name,
      type,
      Date.now(),
      serialise(detail),
    );
  return id;
}

export function endSpan(
  id: string,
  outcome: SpanOutcome = "ok",
  detail?: unknown,
): void {
  ensureTables();
  const extra = serialise(detail);
  getDb()
    .prepare(
      `UPDATE spans
         SET ended_at = ?, outcome = ?, detail = COALESCE(?, detail)
       WHERE id = ?`,
    )
    .run(Date.now(), outcome, extra, id);
}

/** Records an already-finished span in one call. */
export function recordSpan(
  taskId: string,
  name: string,
  type: SpanType,
  parentId: string | null,
  startedAt: number,
  outcome: SpanOutcome,
  detail?: unknown,
): void {
  ensureTables();
  getDb()
    .prepare(
      `INSERT INTO spans (id, task_id, session_id, parent_id, name, type, started_at, ended_at, outcome, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      taskId,
      sessionForTask(taskId),
      parentId,
      name,
      type,
      startedAt,
      Date.now(),
      outcome,
      serialise(detail),
    );
}

/** Drops the oldest logs and the spans of long-finished tasks. */
function prune(): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM logs WHERE id IN (
       SELECT id FROM logs ORDER BY ts DESC LIMIT -1 OFFSET ?
     )`,
  ).run(MAX_LOGS);

  db.prepare(
    `DELETE FROM spans WHERE task_id NOT IN (
       SELECT task_id FROM spans GROUP BY task_id
       ORDER BY MAX(started_at) DESC LIMIT ?
     )`,
  ).run(MAX_TRACED_TASKS);
}
