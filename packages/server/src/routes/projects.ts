import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getDb } from "../db/database";
import { isGitRepo, currentBranch } from "../gitUtils";

const router: Router = Router();

export interface Project {
  id: string;
  name: string;
  path: string;
  color: string | null;
  created_at: number;
  updated_at: number;
}

/** Colours assigned round-robin so each project reads distinctly in the UI. */
const PROJECT_COLORS = [
  "#e8a33d",
  "#4fa97c",
  "#5b8dd9",
  "#d9584c",
  "#8b8ef0",
  "#35c9a6",
  "#d98cc4",
  "#c2894a",
];

function decorate(row: Project) {
  const exists = fs.existsSync(row.path);
  return {
    ...row,
    exists,
    isGitRepo: exists ? isGitRepo(row.path) : false,
    branch: exists ? currentBranch(row.path) : null,
  };
}

// GET /api/projects
router.get("/", (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY created_at ASC")
    .all() as Project[];
  res.json({ projects: rows.map(decorate), total: rows.length });
});

// GET /api/projects/:id
router.get("/:id", (req: Request, res: Response) => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(req.params.id) as Project | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(decorate(row));
});

// POST /api/projects
router.post("/", (req: Request, res: Response) => {
  const { path: repoPath, name, color } = req.body ?? {};

  if (!repoPath || typeof repoPath !== "string") {
    return res.status(400).json({ error: "A folder path is required" });
  }

  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(resolved)) {
    return res.status(400).json({ error: `No folder found at ${resolved}` });
  }
  if (!fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ error: `${resolved} is not a folder` });
  }

  const db = getDb();
  const duplicate = db
    .prepare("SELECT id FROM projects WHERE path = ?")
    .get(resolved);
  if (duplicate) {
    return res.status(409).json({ error: "That folder is already a project" });
  }

  const count = (
    db.prepare("SELECT COUNT(*) as n FROM projects").get() as { n: number }
  ).n;

  const project: Project = {
    id: randomUUID(),
    name: (name && String(name).trim()) || path.basename(resolved),
    path: resolved,
    color: color ?? PROJECT_COLORS[count % PROJECT_COLORS.length],
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  db.prepare(
    `INSERT INTO projects (id, name, path, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
    project.name,
    project.path,
    project.color,
    project.created_at,
    project.updated_at,
  );

  res.status(201).json(decorate(project));
});

// PUT /api/projects/:id
router.put("/:id", (req: Request, res: Response) => {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(req.params.id) as Project | undefined;
  if (!existing) return res.status(404).json({ error: "Not found" });

  const name = req.body?.name ?? existing.name;
  const color = req.body?.color ?? existing.color;
  const updated_at = Date.now();

  db.prepare(
    "UPDATE projects SET name = ?, color = ?, updated_at = ? WHERE id = ?",
  ).run(name, color, updated_at, req.params.id);

  res.json(decorate({ ...existing, name, color, updated_at }));
});

// DELETE /api/projects/:id — removes it from Hive; never touches the folder.
router.delete("/:id", (req: Request, res: Response) => {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM projects WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
