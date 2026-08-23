import { Router, Request, Response } from "express";
import {
  createSchedule,
  getSchedule,
  getSchedules,
  updateSchedule,
  deleteSchedule,
  getScheduleRuns,
  type Schedule,
} from "../db/schedules";
import {
  syncCronJob,
  removeCronJob,
  fireSchedule,
  validateCronExpression,
  getNextRunTimes,
  describeCronExpression,
} from "../scheduler/cronRunner";

const router: Router = Router();

/** Attaches server-computed cron facts so the client never parses cron itself. */
function decorate(schedule: Schedule) {
  if (!schedule.cron_expression) {
    return { ...schedule, nextRuns: [], cronSummary: null };
  }
  return {
    ...schedule,
    nextRuns: getNextRunTimes(schedule.cron_expression, 5),
    cronSummary: describeCronExpression(schedule.cron_expression),
  };
}

// GET /api/schedules - List schedules, optionally scoped to a project
router.get("/", (req: Request, res: Response) => {
  const { limit = "100", offset = "0", projectId } = req.query;
  const limitNum = parseInt(limit as string, 10);
  const offsetNum = parseInt(offset as string, 10);
  const { schedules, total } = getSchedules(
    limitNum,
    offsetNum,
    typeof projectId === "string" && projectId ? projectId : undefined,
  );
  res.json({ schedules: schedules.map(decorate), total });
});

// GET /api/schedules/:id - Get a single schedule
router.get("/:id", (req: Request, res: Response) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Not found" });
  res.json(decorate(schedule));
});

// GET /api/schedules/:id/runs - Run history for a schedule
router.get("/:id/runs", (req: Request, res: Response) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Not found" });
  const { limit = "20" } = req.query;
  const runs = getScheduleRuns(req.params.id, parseInt(limit as string, 10));
  res.json({ runs });
});

// POST /api/schedules - Create a new schedule
router.post("/", (req: Request, res: Response) => {
  const {
    name,
    cron_expression,
    calendar_date,
    workflow_id,
    status = "active",
    project_id,
    color,
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  if (cron_expression) {
    const validation = validateCronExpression(cron_expression);
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.error ?? "Invalid cron expression",
      });
    }
  }

  const schedule = createSchedule({
    name,
    cron_expression,
    calendar_date,
    workflow_id,
    status,
    project_id,
    color,
  });
  syncCronJob(schedule);

  res.status(201).json(decorate(schedule));
});

// POST /api/schedules/:id/run - Trigger a schedule immediately
router.post("/:id/run", (req: Request, res: Response) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Not found" });
  const run = fireSchedule(schedule);
  res.status(202).json({ run });
});

// PUT /api/schedules/:id - Update a schedule
router.put("/:id", (req: Request, res: Response) => {
  const {
    name,
    cron_expression,
    calendar_date,
    workflow_id,
    status,
    project_id,
    color,
  } = req.body;

  if (cron_expression) {
    const validation = validateCronExpression(cron_expression);
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.error ?? "Invalid cron expression",
      });
    }
  }

  const schedule = updateSchedule(req.params.id, {
    name,
    cron_expression,
    calendar_date,
    workflow_id,
    status,
    project_id,
    color,
  });

  if (!schedule) return res.status(404).json({ error: "Not found" });
  syncCronJob(schedule);
  res.json(decorate(schedule));
});

// DELETE /api/schedules/:id - Delete a schedule
router.delete("/:id", (req: Request, res: Response) => {
  const deleted = deleteSchedule(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  removeCronJob(req.params.id);
  res.status(204).end();
});

export default router;
