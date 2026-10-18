import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import { ensureKanbanTable } from "../kanban";
import {
  computeActivityStats,
  startOfDay,
  type ActivityTaskRow,
} from "../activity";

/**
 * Dashboard observability stats — daily agent-run heatmap + growth metrics.
 *
 * Backed by kanban_tasks (see kanban.ts): every board card is one run, with
 * created_at always set. projectId is optional — omit it to aggregate across
 * every project, which is what the Dashboard's Project/All toggle needs.
 */
const router: Router = Router();

const DEFAULT_PERIOD_DAYS = 365;
const MAX_PERIOD_DAYS = 800;

// GET /api/stats/activity?projectId=&days=
router.get("/activity", (req: Request, res: Response) => {
  ensureKanbanTable();
  const db = getDb();

  const projectId =
    typeof req.query.projectId === "string" && req.query.projectId
      ? req.query.projectId
      : null;

  const rawDays = Number(req.query.days);
  const periodDays =
    Number.isFinite(rawDays) && rawDays >= 7 && rawDays <= MAX_PERIOD_DAYS
      ? Math.floor(rawDays)
      : DEFAULT_PERIOD_DAYS;

  const now = Date.now();
  const from = startOfDay(now) - (periodDays - 1) * 86_400_000;

  const clauses = ["created_at >= ?"];
  const params: unknown[] = [from];
  if (projectId) {
    clauses.push("project_id = ?");
    params.push(projectId);
  }

  let rows: ActivityTaskRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT status, harness, iterations, files_changed, created_at
         FROM kanban_tasks
         WHERE ${clauses.join(" AND ")}`,
      )
      .all(...params) as ActivityTaskRow[];
  } catch (err) {
    // Table missing on a fresh DB before any board write — still a valid
    // empty answer, not an error the Dashboard should surface.
    if (!/no such table/i.test(err instanceof Error ? err.message : "")) {
      throw err;
    }
    rows = [];
  }

  res.json(computeActivityStats(rows, periodDays, now));
});

export default router;
