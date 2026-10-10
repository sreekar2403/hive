import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { getDb } from "../db/database";
import { loadConfig } from "../config";
import {
  GenerateError,
  generateWorkflowGraph,
} from "../workflows/generate";
import {
  WorkflowRunError,
  approveStep,
  cancelRun,
  denyStep,
  launchWorkflowRun,
} from "../workflows/executor";
import {
  getWorkflowRun,
  listWorkflowRuns,
} from "../db/workflowRuns";

const router: Router = Router();

// NOTE: registered before "/:id" — Express matches in order and "generate"
// would otherwise be read as a workflow id.
router.post("/generate", async (req: Request, res: Response) => {
  const { description, harness, model, maxNodes } = req.body ?? {};
  try {
    const graph = await generateWorkflowGraph({
      description: typeof description === "string" ? description : "",
      harness: typeof harness === "string" ? harness : undefined,
      model: typeof model === "string" ? model : undefined,
      maxNodes: typeof maxNodes === "number" ? maxNodes : undefined,
    });
    res.json(graph);
  } catch (err) {
    if (err instanceof GenerateError) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: "Workflow generation failed" });
  }
});

function runDeps(): { destructivePatterns: string[] } {
  let patterns: string[] = [];
  try {
    patterns = loadConfig().permission.destructiveActions ?? [];
  } catch {
    // Config unreadable — run without destructive gating rather than refuse.
  }
  return { destructivePatterns: patterns };
}

function runError(res: Response, err: unknown): void {
  if (err instanceof WorkflowRunError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({
    error: err instanceof Error ? err.message : "Workflow run failed",
  });
}

// POST /api/workflows/:id/run — claims a run and returns it at once; the
// graph runs detached. 202 carries a live run, never a finished one.
router.post("/:id/run", (req: Request, res: Response) => {
  const db = getDb();
  const workflow = db
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(req.params.id) as { project_id?: string | null } | undefined;
  if (!workflow) return res.status(404).json({ error: "Workflow not found." });
  const input = typeof req.body?.input === "string" ? req.body.input : "";
  try {
    const runId = launchWorkflowRun(
      {
        workflowId: req.params.id,
        trigger: "manual",
        projectId: workflow.project_id ?? null,
        input,
      },
      runDeps(),
    );
    res.status(202).json({ run: getWorkflowRun(runId) });
  } catch (err) {
    runError(res, err);
  }
});

// GET /api/workflows/:id/runs — run history, newest first.
router.get("/:id/runs", (req: Request, res: Response) => {
  const limit =
    typeof req.query.limit === "string" ? Number(req.query.limit) || 20 : 20;
  res.json({ runs: listWorkflowRuns(req.params.id, Math.min(100, Math.max(1, limit))) });
});

// GET /api/workflows/runs/:runId — run detail with steps.
router.get("/runs/:runId", (req: Request, res: Response) => {
  const run = getWorkflowRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found." });
  res.json({ run, steps: run.steps });
});

// POST /api/workflows/runs/:runId/steps/:nodeId/approve|deny
router.post("/runs/:runId/steps/:nodeId/approve", async (req: Request, res: Response) => {
  try {
    const note = typeof req.body?.note === "string" ? req.body.note : undefined;
    await approveStep(req.params.runId, req.params.nodeId, note);
    res.json({ ok: true });
  } catch (err) {
    runError(res, err);
  }
});

router.post("/runs/:runId/steps/:nodeId/deny", async (req: Request, res: Response) => {
  try {
    const note = typeof req.body?.note === "string" ? req.body.note : undefined;
    await denyStep(req.params.runId, req.params.nodeId, note);
    res.json({ ok: true });
  } catch (err) {
    runError(res, err);
  }
});

// POST /api/workflows/runs/:runId/cancel
router.post("/runs/:runId/cancel", async (req: Request, res: Response) => {
  try {
    await cancelRun(req.params.runId);
    res.json({ ok: true });
  } catch (err) {
    runError(res, err);
  }
});

router.get("/", (req: Request, res: Response) => {
  const db = getDb();
  const total = (
    db.prepare("SELECT COUNT(*) as total FROM workflows").get() as {
      total: number;
    }
  ).total;
  const workflows = db
    .prepare("SELECT * FROM workflows ORDER BY created_at DESC")
    .all();
  res.json({
    workflows: workflows.map((w: any) => ({
      ...w,
      nodes: JSON.parse(w.nodes || "[]"),
      edges: JSON.parse(w.edges || "[]"),
    })),
    total,
  });
});

router.get("/:id", (req: Request, res: Response) => {
  const db = getDb();
  const workflow = db
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(req.params.id) as any;
  if (!workflow) return res.status(404).json({ error: "Not found" });
  res.json({
    ...workflow,
    nodes: JSON.parse(workflow.nodes || "[]"),
    edges: JSON.parse(workflow.edges || "[]"),
  });
});

router.post("/", (req: Request, res: Response) => {
  const { name, nodes = [], edges = [] } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO workflows (id, name, nodes, edges, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, name, JSON.stringify(nodes), JSON.stringify(edges), now, now);
  res
    .status(201)
    .json({ id, name, nodes, edges, created_at: now, updated_at: now });
});

router.put("/:id", (req: Request, res: Response) => {
  const { name, nodes, edges } = req.body;
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: "Not found" });
  const updatedName = name ?? existing.name;
  const updatedNodes = nodes ?? JSON.parse(existing.nodes || "[]");
  const updatedEdges = edges ?? JSON.parse(existing.edges || "[]");
  const now = Date.now();
  db.prepare(
    "UPDATE workflows SET name = ?, nodes = ?, edges = ?, updated_at = ? WHERE id = ?",
  ).run(
    updatedName,
    JSON.stringify(updatedNodes),
    JSON.stringify(updatedEdges),
    now,
    req.params.id,
  );
  res.json({
    id: req.params.id,
    name: updatedName,
    nodes: updatedNodes,
    edges: updatedEdges,
    created_at: existing.created_at,
    updated_at: now,
  });
});

router.delete("/:id", (req: Request, res: Response) => {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM workflows WHERE id = ?")
    .run(req.params.id);
  if ((result as any).changes === 0)
    return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
