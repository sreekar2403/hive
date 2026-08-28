import { Router, Request, Response } from "express";
import { Orchestrator } from "../orchestrator";
import type { SecondBrain } from "../secondBrain";
import type { BrainScope, BrainShelf, BrainStore } from "../secondBrain/types";

/**
 * The Second Brain's HTTP surface — soul.md, the learned stores, the graph,
 * and the suggestion queue that gates writes into soul.md.
 *
 * Every route is scoped to a project, because the stores are: `?projectId=`
 * selects which working tree's `mem/` is read, and omitting it falls back to
 * the server's own directory. The brain itself is owned by the Orchestrator
 * (one per working tree, cached), so it is fetched per-request rather than
 * injected — that way a config change through Settings is picked up without
 * a restart.
 */
const router: Router = Router();

const SCOPES: BrainScope[] = ["global", "project"];
const STORES: BrainStore[] = ["user", "task"];
const SHELVES: BrainShelf[] = [
  "preferences",
  "patterns",
  "rules",
  "failures",
  "strategies",
  "routing",
];

/**
 * Resolves the brain for the request's project. Returns null (having already
 * answered) when no Orchestrator exists yet — which happens if a client polls
 * during startup.
 */
function brainFor(req: Request, res: Response): SecondBrain | null {
  const orchestrator = Orchestrator.getActive();
  if (!orchestrator) {
    res.status(503).json({ error: "Orchestrator not started yet" });
    return null;
  }
  const projectId =
    typeof req.query.projectId === "string" && req.query.projectId
      ? req.query.projectId
      : typeof req.body?.projectId === "string" && req.body.projectId
        ? req.body.projectId
        : null;
  return orchestrator.brainForProject(projectId);
}

function scopeFrom(
  value: unknown,
  fallback: BrainScope = "global",
): BrainScope {
  return SCOPES.includes(value as BrainScope)
    ? (value as BrainScope)
    : fallback;
}

/** GET /api/brain — store sizes, roots on disk, and whether the layer is on. */
router.get("/", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;
  res.json({ ...brain.stats(), settings: brain.settings });
});

/* ------------------------------------------------------------------ */
/* soul.md                                                             */
/* ------------------------------------------------------------------ */

/** GET /api/brain/soul — both scopes, global first. */
router.get("/soul", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;
  res.json(brain.soul.readAll());
});

/** PUT /api/brain/soul — write to default (project) scope for simple editors. */
router.put("/soul", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const content = req.body?.content;
  if (typeof content !== "string") {
    return res.status(400).json({ error: "content (string) is required" });
  }

  try {
    res.json(brain.soul.write("project", content));
  } catch (err) {
    res.status(500).json({ error: message(err) });
  }
});

/** GET /api/brain/soul/:scope — one scope's file, template if it doesn't exist. */
router.get("/soul/:scope", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;
  res.json(brain.soul.read(scopeFrom(req.params.scope)));
});

/** PUT /api/brain/soul/:scope — the user editing their own soul.md. */
router.put("/soul/:scope", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const content = req.body?.content;
  if (typeof content !== "string") {
    return res.status(400).json({ error: "content (string) is required" });
  }

  try {
    res.json(brain.soul.write(scopeFrom(req.params.scope), content));
  } catch (err) {
    res.status(500).json({ error: message(err) });
  }
});

/* ------------------------------------------------------------------ */
/* Suggestions — the only automated path into soul.md                  */
/* ------------------------------------------------------------------ */

/** GET /api/brain/suggestions — pending first, then recently resolved. */
router.get("/suggestions", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const scope = scopeFrom(req.query.scope);
  const all = brain.soul.listSuggestions(scope);
  const pending = all.filter((s) => s.status === "pending");
  const resolved = all.filter((s) => s.status !== "pending").slice(0, 50);
  res.json({ pending, resolved });
});

/** POST /api/brain/suggestions/:id/approve — appends the entry to soul.md. */
router.post("/suggestions/:id/approve", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const soul = brain.soul.approveSuggestion(
    req.params.id,
    scopeFrom(req.body?.scope),
  );
  if (!soul) {
    return res
      .status(404)
      .json({ error: "No pending suggestion with that id" });
  }
  res.json({ approved: true, soul });
});

/** POST /api/brain/suggestions/:id/reject — and never propose it again. */
router.post("/suggestions/:id/reject", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const ok = brain.soul.rejectSuggestion(
    req.params.id,
    scopeFrom(req.body?.scope),
  );
  if (!ok) {
    return res
      .status(404)
      .json({ error: "No pending suggestion with that id" });
  }
  res.json({ rejected: true });
});

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

/** GET /api/brain/records — the learned stores, filterable. */
router.get("/records", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const store = req.query.store as BrainStore | undefined;
  const shelf = req.query.shelf as BrainShelf | undefined;

  res.json(
    brain.records.list({
      store: store && STORES.includes(store) ? store : undefined,
      shelf: shelf && SHELVES.includes(shelf) ? shelf : undefined,
      category:
        typeof req.query.category === "string" ? req.query.category : undefined,
      harness:
        typeof req.query.harness === "string" ? req.query.harness : undefined,
      text: typeof req.query.q === "string" ? req.query.q : undefined,
      limit: numberFrom(req.query.limit, 100),
    }),
  );
});

/**
 * POST /api/brain/records — an explicit "remember this".
 *
 * Stored as a user-sourced, pre-approved rule: the user saying something
 * outright is the one input the layer never second-guesses.
 */
router.post("/records", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    return res
      .status(400)
      .json({ error: "text (non-empty string) is required" });
  }

  const record = brain.note(text, {
    scope: scopeFrom(req.body?.scope),
    category: typeof req.body?.category === "string" ? req.body.category : null,
    tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
  });

  if (!record) {
    return res
      .status(409)
      .json({ error: "Explicit notes are disabled in this project's config" });
  }
  res.status(201).json(record);
});

/** DELETE /api/brain/records/:id — forget one thing. */
router.delete("/records/:id", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const existing = brain.records.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "No such record" });

  // A record can exist in either scope (or both); remove wherever it is,
  // otherwise "forget this" would appear to fail on a global record.
  const removed = SCOPES.map((scope) =>
    brain.records.remove(
      scope,
      { store: existing.store, shelf: existing.shelf },
      existing.id,
    ),
  ).some(Boolean);

  res.json({ removed });
});

/* ------------------------------------------------------------------ */
/* Graph and retrieval                                                 */
/* ------------------------------------------------------------------ */

/** GET /api/brain/graph — nodes and edges, for visualisation. */
router.get("/graph", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;
  res.json(brain.graph.load());
});

/** GET /api/brain/insights?q= — cross-domain traversal from a seed. */
router.get("/insights", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const query = typeof req.query.q === "string" ? req.query.q : "";
  if (!query) return res.status(400).json({ error: "q is required" });
  res.json(brain.getGraphInsights(query, numberFrom(req.query.limit, 8)));
});

/**
 * POST /api/brain/briefing — exactly what a task would be told, for a
 * prompt. This is the "show me what you'd inject" endpoint: the layer is
 * only trustworthy if you can see what it is about to say on your behalf.
 */
router.post("/briefing", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res
      .status(400)
      .json({ error: "prompt (non-empty string) is required" });
  }

  res.json(
    brain.getBriefing({
      taskId: "preview",
      prompt,
      category: brain.categorize(prompt),
      harness: typeof req.body?.harness === "string" ? req.body.harness : null,
      projectId:
        typeof req.body?.projectId === "string" ? req.body.projectId : null,
    }),
  );
});

/** GET /api/brain/routing?q= — the learned advice the Router would receive. */
router.get("/routing", (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  const query = typeof req.query.q === "string" ? req.query.q : "";
  if (!query) return res.status(400).json({ error: "q is required" });
  res.json({
    category: brain.categorize(query),
    hints: brain.getRoutingHints(query),
  });
});

/**
 * POST /api/brain/learn — run the periodic batch now.
 *
 * `force` skips the interval and the "is anything running?" check, which is
 * what you want from a button labelled "Learn now" and never what you want
 * on a timer.
 */
router.post("/learn", async (req: Request, res: Response) => {
  const brain = brainFor(req, res);
  if (!brain) return;

  try {
    const queued = await brain.runLearningBatch(req.body?.force !== false);
    if (queued === null) {
      return res.json({
        ran: false,
        reason: "Learning is disabled or already running",
      });
    }
    res.json({ ran: true, suggestions: queued });
  } catch (err) {
    res.status(500).json({ error: message(err) });
  }
});

function numberFrom(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default router;
