import { Router, Request, Response } from 'express';
import { getDb, closeDb } from '../db/database';
import { createSchedule, getSchedule, getSchedules, updateSchedule, deleteSchedule } from '../db/schedules';

const router = Router();

// GET /api/schedules - List all schedules
router.get('/', (req: Request, res: Response) => {
  const { limit = '100', offset = '0' } = req.query;
  const limitNum = parseInt(limit as string, 10);
  const offsetNum = parseInt(offset as string, 10);
  const { schedules, total } = getSchedules(limitNum, offsetNum);
  res.json({ schedules, total });
});

// GET /api/schedules/:id - Get a single schedule
router.get('/:id', (req: Request, res: Response) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Not found' });
  res.json(schedule);
});

// POST /api/schedules - Create a new schedule
router.post('/', (req: Request, res: Response) => {
  const { name, cron_expression, calendar_date, workflow_id, status = 'active' } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const schedule = createSchedule({
    name,
    cron_expression,
    calendar_date,
    workflow_id,
    status,
  });

  res.status(201).json(schedule);
});

// PUT /api/schedules/:id - Update a schedule
router.put('/:id', (req: Request, res: Response) => {
  const { name, cron_expression, calendar_date, workflow_id, status } = req.body;
  const schedule = updateSchedule(req.params.id, { name, cron_expression, calendar_date, workflow_id, status });

  if (!schedule) return res.status(404).json({ error: 'Not found' });
  res.json(schedule);
});

// DELETE /api/schedules/:id - Delete a schedule
router.delete('/:id', (req: Request, res: Response) => {
  const deleted = deleteSchedule(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;