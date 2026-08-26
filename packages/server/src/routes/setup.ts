import { Router, Request, Response } from "express";
import { loadConfig, saveConfig } from "../config";
import { SecondBrain } from "../secondBrain";
import {
  completeSetup,
  getSetupStatus,
  isSetupComplete,
  type CompleteSetupInput,
} from "../setup";

/**
 * First-run setup: the one question Hive asks before it starts working, and
 * the endpoint that records the answer.
 *
 * Everything here is idempotent. The UI can poll status, the user can re-run
 * setup from Settings, and a half-finished run leaves nothing to clean up.
 * See setup.ts for what the answer actually does.
 */
const router: Router = Router();

function brain(): SecondBrain {
  // Global scope: setup writes the machine-wide soul.md, not a project's.
  return new SecondBrain(loadConfig(), null);
}

// GET /api/setup — what to ask, and whether to ask it
router.get("/", async (_req: Request, res: Response) => {
  try {
    const config = loadConfig();
    res.json(await getSetupStatus(config, brain()));
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not read setup state",
    });
  }
});

// POST /api/setup — record the answer, seed soul.md, enable what's installed
router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as CompleteSetupInput;

  if (body.routerModel !== undefined && typeof body.routerModel !== "string") {
    return res.status(400).json({ error: "routerModel must be a string" });
  }
  if (
    body.enabledHarnesses !== undefined &&
    (!Array.isArray(body.enabledHarnesses) ||
      body.enabledHarnesses.some((h) => typeof h !== "string"))
  ) {
    return res
      .status(400)
      .json({ error: "enabledHarnesses must be an array of harness ids" });
  }

  try {
    const config = loadConfig();
    const result = await completeSetup(config, brain(), body);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Setup failed",
    });
  }
});

// POST /api/setup/reset — ask again next time the UI loads
router.post("/reset", (_req: Request, res: Response) => {
  const config = loadConfig();
  config.setup = { completed: false, completedAt: 0, version: 0 };
  // Saved through the same path everything else uses, so the on-disk file
  // and the live singleton stay in step.
  saveConfig(config);
  res.json({ ok: true, needed: !isSetupComplete(config, brain()) });
});

export default router;
