import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import type { LogRow, SpanRow } from "../telemetry";

const router: Router = Router();

interface LogDbRow {
  id: string;
  ts: number;
  level: string;
  source: string;
  message: string;
  task_id: string | null;
  project_id: string | null;
  context: string | null;
}

interface SpanDbRow {
  id: string;
  task_id: string;
  session_id: string | null;
  parent_id: string | null;
  name: string;
  type: string;
  started_at: number;
  ended_at: number | null;
  outcome: string | null;
  detail: string | null;
}

function toLog(r: LogDbRow): LogRow {
  return {
    id: r.id,
    ts: r.ts,
    level: r.level as LogRow["level"],
    source: r.source,
    message: r.message,
    taskId: r.task_id,
    projectId: r.project_id,
    context: r.context,
  };
}

function toSpan(r: SpanDbRow): SpanRow {
  return {
    id: r.id,
    taskId: r.task_id,
    sessionId: r.session_id ?? null,
    parentId: r.parent_id,
    name: r.name,
    type: r.type as SpanRow["type"],
    startedAt: r.started_at,
    endedAt: r.ended_at,
    outcome: r.outcome as SpanRow["outcome"],
    detail: r.detail,
  };
}

/** The tables are created lazily by telemetry.ts on first write. */
function tableMissing(err: unknown): boolean {
  return err instanceof Error && /no such table/i.test(err.message);
}

// GET /api/logs?level=&source=&projectId=&taskId=&q=&limit=&since=
router.get("/", (req: Request, res: Response) => {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const str = (k: string) =>
    typeof req.query[k] === "string" && req.query[k] ? (req.query[k] as string) : null;

  const level = str("level");
  if (level) {
    clauses.push("level = ?");
    params.push(level);
  }
  const source = str("source");
  if (source) {
    clauses.push("source = ?");
    params.push(source);
  }
  const projectId = str("projectId");
  if (projectId) {
    // Logs written before a project was known are still relevant, so they
    // stay visible rather than being filtered out entirely.
    clauses.push("(project_id = ? OR project_id IS NULL)");
    params.push(projectId);
  }
  const taskId = str("taskId");
  if (taskId) {
    clauses.push("task_id = ?");
    params.push(taskId);
  }
  const q = str("q");
  if (q) {
    clauses.push("(message LIKE ? OR source LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const since = str("since");
  if (since) {
    clauses.push("ts > ?");
    params.push(parseInt(since, 10));
  }

  const limit = Math.min(2000, parseInt(str("limit") ?? "500", 10) || 500);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  try {
    const rows = getDb()
      .prepare(`SELECT * FROM logs ${where} ORDER BY ts DESC LIMIT ?`)
      .all(...params, limit) as LogDbRow[];
    const sources = getDb()
      .prepare("SELECT DISTINCT source FROM logs ORDER BY source")
      .all() as Array<{ source: string }>;
    res.json({
      logs: rows.map(toLog),
      sources: sources.map((s) => s.source),
    });
  } catch (err) {
    if (tableMissing(err)) return res.json({ logs: [], sources: [] });
    throw err;
  }
});

// GET /api/logs/traces?projectId= — one row per traced task run
router.get("/traces", (req: Request, res: Response) => {
  const projectId =
    typeof req.query.projectId === "string" ? req.query.projectId : null;
  const sessionId =
    typeof req.query.sessionId === "string" && req.query.sessionId
      ? req.query.sessionId
      : null;

  try {
    const rows = getDb()
      .prepare(
        `SELECT
           s.task_id                              AS taskId,
           MAX(s.session_id)                      AS sessionId,
           MIN(s.started_at)                      AS startedAt,
           MAX(COALESCE(s.ended_at, s.started_at)) AS endedAt,
           COUNT(*)                               AS spanCount,
           SUM(CASE WHEN s.outcome = 'failed' THEN 1 ELSE 0 END) AS failures
         FROM spans s
         ${sessionId ? "WHERE s.session_id = ?" : ""}
         GROUP BY s.task_id
         ORDER BY startedAt DESC
         LIMIT 100`,
      )
      .all(...(sessionId ? [sessionId] : [])) as Array<{
      taskId: string;
      sessionId: string | null;
      startedAt: number;
      endedAt: number;
      spanCount: number;
      failures: number;
    }>;

    // The root span carries the prompt and harness; join it back on.
    const roots = getDb()
      .prepare("SELECT * FROM spans WHERE parent_id IS NULL")
      .all() as SpanDbRow[];

    const traces = rows
      .map((r) => {
        const root = roots.find((x) => x.task_id === r.taskId);
        return {
          taskId: r.taskId,
          sessionId: r.sessionId,
          name: root?.name ?? r.taskId,
          startedAt: r.startedAt,
          durationMs: r.endedAt - r.startedAt,
          spanCount: r.spanCount,
          status: r.failures > 0 ? "failed" : root?.ended_at ? "ok" : "running",
          detail: root?.detail ?? null,
        };
      })
      .filter((t) => {
        if (!projectId) return true;
        // A run recorded before its project was known still belongs in the
        // list; only exclude ones that name a *different* project.
        try {
          const runProject = t.detail ? JSON.parse(t.detail).projectId : null;
          return !runProject || runProject === projectId;
        } catch {
          return true;
        }
      });

    res.json({ traces });
  } catch (err) {
    if (tableMissing(err)) return res.json({ traces: [] });
    throw err;
  }
});

/*
 * GET /api/logs/conversations?projectId= — one row per chat conversation.
 *
 * A trace covers a single message. A conversation is the thing a person
 * actually followed, so its runs are rolled up here and the individual
 * traces stay reachable underneath.
 */
router.get("/conversations", (req: Request, res: Response) => {
  const projectId =
    typeof req.query.projectId === "string" ? req.query.projectId : null;

  try {
    const rows = getDb()
      .prepare(
        `SELECT
           s.session_id                            AS sessionId,
           COUNT(DISTINCT s.task_id)               AS runCount,
           COUNT(*)                                AS spanCount,
           MIN(s.started_at)                       AS startedAt,
           MAX(COALESCE(s.ended_at, s.started_at)) AS endedAt,
           SUM(CASE WHEN s.outcome = 'failed' THEN 1 ELSE 0 END) AS failures
         FROM spans s
         WHERE s.session_id IS NOT NULL
         GROUP BY s.session_id
         ORDER BY startedAt DESC
         LIMIT 100`,
      )
      .all() as Array<{
      sessionId: string;
      runCount: number;
      spanCount: number;
      startedAt: number;
      endedAt: number;
      failures: number;
    }>;

    const roots = getDb()
      .prepare("SELECT * FROM spans WHERE parent_id IS NULL AND session_id IS NOT NULL")
      .all() as SpanDbRow[];

    const conversations = rows
      .map((r) => {
        const mine = roots.filter((x) => x.session_id === r.sessionId);
        const first = mine.sort((a, b) => a.started_at - b.started_at)[0];
        return {
          sessionId: r.sessionId,
          name: first?.name ?? r.sessionId,
          runCount: r.runCount,
          spanCount: r.spanCount,
          startedAt: r.startedAt,
          durationMs: r.endedAt - r.startedAt,
          status: r.failures > 0 ? "failed" : "ok",
          taskIds: mine.map((x) => x.task_id),
          detail: first?.detail ?? null,
        };
      })
      .filter((c) => {
        if (!projectId) return true;
        try {
          const runProject = c.detail ? JSON.parse(c.detail).projectId : null;
          return !runProject || runProject === projectId;
        } catch {
          return true;
        }
      });

    res.json({ conversations });
  } catch (err) {
    if (tableMissing(err)) return res.json({ conversations: [] });
    throw err;
  }
});

/*
 * GET /api/logs/conversations/:sessionId — every span of every run in one
 * conversation, in order, so the whole exchange reads as a single trace.
 */
router.get("/conversations/:sessionId", (req: Request, res: Response) => {
  try {
    const spans = getDb()
      .prepare(
        "SELECT * FROM spans WHERE session_id = ? ORDER BY started_at ASC",
      )
      .all(req.params.sessionId) as SpanDbRow[];
    if (spans.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({
      sessionId: req.params.sessionId,
      taskIds: [...new Set(spans.map((s) => s.task_id))],
      spans: spans.map(toSpan),
    });
  } catch (err) {
    if (tableMissing(err)) return res.status(404).json({ error: "Not found" });
    throw err;
  }
});

// GET /api/logs/traces/:taskId — the full span tree for one run
router.get("/traces/:taskId", (req: Request, res: Response) => {
  try {
    const spans = getDb()
      .prepare("SELECT * FROM spans WHERE task_id = ? ORDER BY started_at ASC")
      .all(req.params.taskId) as SpanDbRow[];
    if (spans.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ taskId: req.params.taskId, spans: spans.map(toSpan) });
  } catch (err) {
    if (tableMissing(err)) return res.status(404).json({ error: "Not found" });
    throw err;
  }
});

export default router;
