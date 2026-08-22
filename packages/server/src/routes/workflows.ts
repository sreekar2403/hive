import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const workflows = db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all();
  res.json(workflows.map((w: any) => ({ ...w, nodes: JSON.parse(w.nodes || '[]'), edges: JSON.parse(w.edges || '[]') })));
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id) as any;
  if (!workflow) return res.status(404).json({ error: 'Not found' });
  res.json({ ...workflow, nodes: JSON.parse(workflow.nodes || '[]'), edges: JSON.parse(workflow.edges || '[]') });
});

router.post('/', (req: Request, res: Response) => {
  const { name, nodes = [], edges = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const db = getDb();
  const id = require('crypto').randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO workflows (id, name, nodes, edges, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, JSON.stringify(nodes), JSON.stringify(edges), now, now);
  res.status(201).json({ id, name, nodes, edges, created_at: now, updated_at: now });
});

router.put('/:id', (req: Request, res: Response) => {
  const { name, nodes, edges } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const updatedName = name ?? existing.name;
  const updatedNodes = nodes ?? JSON.parse(existing.nodes || '[]');
  const updatedEdges = edges ?? JSON.parse(existing.edges || '[]');
  const now = Date.now();
  db.prepare('UPDATE workflows SET name = ?, nodes = ?, edges = ?, updated_at = ? WHERE id = ?').run(updatedName, JSON.stringify(updatedNodes), JSON.stringify(updatedEdges), now, req.params.id);
  res.json({ id: req.params.id, name: updatedName, nodes: updatedNodes, edges: updatedEdges, created_at: existing.created_at, updated_at: now });
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM workflows WHERE id = ?').run(req.params.id);
  if ((result as any).changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
