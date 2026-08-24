import { randomUUID } from "crypto";
import { getDb } from "./database";

const db = getDb();

/** Colours assigned round-robin so each schedule reads distinctly in the UI. */
export const SCHEDULE_COLORS = [
  "#e8a33d",
  "#4fa97c",
  "#5b8dd9",
  "#d9584c",
  "#8b8ef0",
  "#35c9a6",
  "#d98cc4",
  "#c2894a",
];

export interface Schedule {
  id: string;
  name: string;
  cron_expression: string | null;
  calendar_date: string | null;
  workflow_id: string | null;
  status: string;
  project_id: string | null;
  color: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateScheduleInput {
  name: string;
  cron_expression?: string;
  calendar_date?: string;
  workflow_id?: string;
  status?: string;
  project_id?: string;
  color?: string;
}

export function createSchedule(input: CreateScheduleInput): Schedule {
  const id = randomUUID();
  const now = Date.now();
  const count = (
    db.prepare("SELECT COUNT(*) as n FROM schedules").get() as { n: number }
  ).n;

  const schedule: Schedule = {
    id,
    name: input.name,
    cron_expression: input.cron_expression || null,
    calendar_date: input.calendar_date || null,
    workflow_id: input.workflow_id || null,
    status: input.status || "active",
    project_id: input.project_id || null,
    color: input.color || SCHEDULE_COLORS[count % SCHEDULE_COLORS.length],
    created_at: now,
    updated_at: now,
  };

  const stmt = db.prepare(`
    INSERT INTO schedules (id, name, cron_expression, calendar_date, workflow_id, status, project_id, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    schedule.id,
    schedule.name,
    schedule.cron_expression,
    schedule.calendar_date,
    schedule.workflow_id,
    schedule.status,
    schedule.project_id,
    schedule.color,
    schedule.created_at,
    schedule.updated_at,
  );

  return schedule;
}

export function getSchedule(id: string): Schedule | null {
  const stmt = db.prepare("SELECT * FROM schedules WHERE id = ?");
  const row = stmt.get(id) as Schedule | undefined;
  if (!row) return null;
  return row;
}

export function getSchedules(
  limit = 100,
  offset = 0,
  projectId?: string,
): { schedules: Schedule[]; total: number } {
  const where = projectId ? "WHERE project_id = ?" : "";
  const whereParams = projectId ? [projectId] : [];

  const countStmt = db.prepare(
    `SELECT COUNT(*) as total FROM schedules ${where}`,
  );
  const total = (countStmt.get(...whereParams) as { total: number }).total;

  const stmt = db.prepare(
    `SELECT * FROM schedules ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  );
  const rows = stmt.all(...whereParams, limit, offset) as Schedule[];

  return { schedules: rows, total };
}

export function updateSchedule(
  id: string,
  input: Partial<CreateScheduleInput>,
): Schedule | null {
  const existing = getSchedule(id);
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const cron_expression = input.cron_expression ?? existing.cron_expression;
  const calendar_date = input.calendar_date ?? existing.calendar_date;
  const workflow_id = input.workflow_id ?? existing.workflow_id;
  const status = input.status ?? existing.status;
  const project_id = input.project_id ?? existing.project_id;
  const color = input.color ?? existing.color;
  const updated_at = Date.now();

  const stmt = db.prepare(`
    UPDATE schedules SET name = ?, cron_expression = ?, calendar_date = ?, workflow_id = ?, status = ?, project_id = ?, color = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(
    name,
    cron_expression,
    calendar_date,
    workflow_id,
    status,
    project_id,
    color,
    updated_at,
    id,
  );

  return getSchedule(id);
}

export function deleteSchedule(id: string): boolean {
  const stmt = db.prepare("DELETE FROM schedules WHERE id = ?");
  const result = stmt.run(id);
  return (result as any).changes > 0;
}

/* ------------------------------------------------------------------ */
/* Run history                                                         */
/* ------------------------------------------------------------------ */

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
}

export interface RecordScheduleRunInput {
  scheduleId: string;
  status: string;
  startedAt: number;
  finishedAt: number;
}

export function recordScheduleRun(input: RecordScheduleRunInput): ScheduleRun {
  const run: ScheduleRun = {
    id: randomUUID(),
    schedule_id: input.scheduleId,
    status: input.status,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    duration_ms: input.finishedAt - input.startedAt,
  };

  db.prepare(
    `INSERT INTO schedule_runs (id, schedule_id, status, started_at, finished_at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.schedule_id,
    run.status,
    run.started_at,
    run.finished_at,
    run.duration_ms,
  );

  return run;
}

export function getScheduleRuns(scheduleId: string, limit = 20): ScheduleRun[] {
  const stmt = db.prepare(
    "SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?",
  );
  return stmt.all(scheduleId, limit) as ScheduleRun[];
}
