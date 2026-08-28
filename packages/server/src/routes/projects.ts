import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getDb } from "../db/database";
import { isGitRepo, currentBranch } from "../gitUtils";
import { generalProject, isGeneralProject } from "../generalWorkspace";
import { loadConfig } from "../config";
import { seedProjectSoul } from "../setup";
import { log } from "../telemetry";

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

// GET /api/projects — the general workspace is always first, so a fresh
// install has somewhere to chat before any repository is attached.
router.get("/", (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY created_at ASC")
    .all() as Project[];
  const projects = [generalProject(), ...rows.map(decorate)];
  res.json({ projects, total: projects.length });
});

// GET /api/projects/:id
router.get("/:id", (req: Request, res: Response) => {
  if (isGeneralProject(req.params.id)) return res.json(generalProject());
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

  if (resolved === generalProject().path) {
    return res
      .status(409)
      .json({ error: "That folder is already the general workspace." });
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

  // Give the new project its own soul.md. It starts nearly empty on purpose:
  // the machine-wide soul carries the routing table, and this file is where
  // what's different about *this* repository gets written — by the user, or
  // by the Second Brain once it has watched enough work here to suggest
  // something. Seeding it now means there is a file to open rather than a
  // concept to discover.
  try {
    const seeded = seedProjectSoul(loadConfig(), project.path, project.name);
    if (seeded.written) {
      log("info", "projects", `Seeded soul.md for ${project.name}`, {
        projectId: project.id,
        context: { path: seeded.path },
      });
    }
  } catch (err) {
    // A project that exists without a soul.md is fine — the Second Brain
    // falls back to the template on read. Failing the whole creation over
    // it would not be.
    log("warn", "projects", `Could not seed soul.md for ${project.name}`, {
      projectId: project.id,
      context: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  res.status(201).json(decorate(project));
});

// PUT /api/projects/:id
router.put("/:id", (req: Request, res: Response) => {
  if (isGeneralProject(req.params.id)) {
    return res.status(400).json({
      error:
        "The general workspace cannot be renamed. Change its folder under Settings, General.",
    });
  }
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

/**
 * DELETE /api/projects/:id — removes it from Hive; never touches the folder.
 *
 * The row is not the only thing that referred to it. Board cards, chat
 * sessions, schedules, workflows and log lines all carry a `project_id`,
 * and deleting only the project left every one of them pointing at
 * something that no longer exists: cards that cannot be opened, schedules
 * that fire against a missing path, a Logs screen filtered by a project
 * that is not in the filter list.
 *
 * So the delete takes them with it, and says what it took — removing
 * sixteen board cards is not something to do silently, and the count is
 * what lets the client warn before asking.
 *
 * Chat sessions are kept and unscoped rather than deleted: the
 * conversation is the user's, not the project's, and it still reads
 * perfectly well without a repository attached. Everything else is
 * meaningless without its project and goes.
 */
router.delete("/:id", (req: Request, res: Response) => {
  const id = req.params.id;
  if (isGeneralProject(id)) {
    return res
      .status(400)
      .json({ error: "The general workspace cannot be removed." });
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const removed = db.transaction(() => {
    const counts = {
      tasks: db.prepare("DELETE FROM kanban_tasks WHERE project_id = ?").run(id)
        .changes,
      schedules: db
        .prepare("DELETE FROM schedules WHERE project_id = ?")
        .run(id).changes,
      workflows: db
        .prepare("DELETE FROM workflows WHERE project_id = ?")
        .run(id).changes,
      logs: db.prepare("DELETE FROM logs WHERE project_id = ?").run(id).changes,
      // Kept, but no longer pointing at a project that is gone.
      sessions: db
        .prepare(
          "UPDATE chat_sessions SET project_id = NULL WHERE project_id = ?",
        )
        .run(id).changes,
    };
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return counts;
  })();

  res.json({ removed });
});

/**
 * GET /api/projects/:id/usage — what deleting this project would take.
 *
 * Asked before the confirmation is shown, so the dialog can say "and 16
 * board cards" rather than making the user find out afterwards.
 */
router.get("/:id/usage", (req: Request, res: Response) => {
  const id = req.params.id;
  const db = getDb();
  const count = (sql: string) =>
    (db.prepare(sql).get(id) as { c: number } | undefined)?.c ?? 0;

  res.json({
    tasks: count("SELECT COUNT(*) c FROM kanban_tasks WHERE project_id = ?"),
    schedules: count("SELECT COUNT(*) c FROM schedules WHERE project_id = ?"),
    workflows: count("SELECT COUNT(*) c FROM workflows WHERE project_id = ?"),
    sessions: count(
      "SELECT COUNT(*) c FROM chat_sessions WHERE project_id = ?",
    ),
  });
});

export default router;
