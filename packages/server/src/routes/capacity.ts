import { Router, Request, Response } from "express";
import { detectSystemCapacity, effectiveAgentLimit } from "../capacity";
import { loadConfig } from "../config";
import { Orchestrator } from "../orchestrator";

/**
 * What this machine can run, and what it is running.
 *
 * The Office floor and the board both size themselves against this: how
 * many agents can work at once is a property of the machine, and showing a
 * floor with room for eight on a laptop that can drive two is a lie.
 */
const router: Router = Router();

// GET /api/capacity
router.get("/", (_req: Request, res: Response) => {
  const system = detectSystemCapacity();
  let configured: number | undefined;
  try {
    configured = loadConfig().loop?.maxConcurrentAgents;
  } catch {
    // A malformed config file shouldn't take the floor down with it.
    configured = undefined;
  }
  const load = Orchestrator.getActive()?.loadSnapshot() ?? {
    running: 0,
    queued: 0,
    limit: effectiveAgentLimit(configured),
  };

  res.json({
    system,
    /** null when nothing is pinned and the machine decides. */
    configuredAgents:
      typeof configured === "number" && configured >= 1 ? configured : null,
    effectiveAgents: effectiveAgentLimit(configured),
    load,
  });
});

export default router;
