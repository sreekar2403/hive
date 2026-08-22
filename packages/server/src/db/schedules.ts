import Database from 'better-sqlite3';
import { initDb, getDb, closeDb } from './database';

const db = getDb();

export interface Schedule {
  id: string;
  name: string;
  cron_expression: string | null;
  calendar_date: string | null;
  workflow_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface CreateScheduleInput {
  name: string;
  cron_expression?: string;
  calendar_date?: string;
  workflow_id?: string;
  status?: string;
}

export function createSchedule(input: CreateScheduleInput): Schedule {
  const id = require('crypto').randomUUID();
  const now = Date.now();
  const schedule: Schedule = {
    id,
    name: input.name,
    cron_expression: input.cron_expression || null,
    calendar_date: input.calendar_date || null,
    workflow_id: input.workflow_id || null,
    status: input.status || 'active',
    created_at: now,
    updated_at: now,
  };

  const stmt = db.prepare(`
    INSERT INTO schedules (id, name, cron_expression, calendar_date, workflow_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    schedule.id,
    schedule.name,
    schedule.cron_expression,
    schedule.calendar_date,
    schedule.workflow_id,
    schedule.status,
    schedule.created_at,
    schedule.updated_at,
  );

  return schedule;
}

export function getSchedule(id: string): Schedule | null {
  const stmt = db.prepare('SELECT * FROM schedules WHERE id = ?');
  const row = stmt.get(id) as Schedule | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    cron_expression: row.cron_expression,
    calendar_date: row.calendar_date,
    workflow_id: row.workflow_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getSchedules(limit = 100, offset = 0): { schedules: Schedule[]; total: number } {
  const countStmt = db.prepare('SELECT COUNT(*) as total FROM schedules');
  const total = (countStmt.get() as { total: number }).total;

  const stmt = db.prepare('SELECT * FROM schedules ORDER BY created_at DESC LIMIT ? OFFSET ?');
  const rows = stmt.all(limit, offset) as Schedule[];

  const schedules = rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    cron_expression: row.cron_expression,
    calendar_date: row.calendar_date,
    workflow_id: row.workflow_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return { schedules, total };
}

export function updateSchedule(id: string, input: Partial<CreateScheduleInput>): Schedule | null {
  const existing = getSchedule(id);
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const cron_expression = input.cron_expression ?? existing.cron_expression;
  const calendar_date = input.calendar_date ?? existing.calendar_date;
  const workflow_id = input.workflow_id ?? existing.workflow_id;
  const status = input.status ?? existing.status;
  const updated_at = Date.now();

  const stmt = db.prepare(`
    UPDATE schedules SET name = ?, cron_expression = ?, calendar_date = ?, workflow_id = ?, status = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(name, cron_expression, calendar_date, workflow_id, status, updated_at, id);

  return getSchedule(id);
}

export function deleteSchedule(id: string): boolean {
  const stmt = db.prepare('DELETE FROM schedules WHERE id = ?');
  const result = stmt.run(id);
  return (result as any).changes > 0;
}