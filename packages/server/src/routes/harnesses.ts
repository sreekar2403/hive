import { Router, Request, Response } from "express";
import { checkInstalled, checkStreamContracts } from "../harnesses/health";
import { loadConfig } from "../config";

/**
 * Whether the CLIs Hive drives are installed, and whether they still emit
 * the event stream it parses. See harnesses/health.ts for why the second
 * question needs asking at all.
 */
const router: Router = Router();

function config() {
  try {
    return loadConfig();
  } catch {
    return undefined;
  }
}

// GET /api/harnesses — installed or not. Cheap.
router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json({ harnesses: await checkInstalled(config()) });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not check harnesses",
    });
  }
});

/*
 * POST /api/harnesses/health — the deep check.
 *
 * Runs a real prompt through each installed CLI, so it costs tokens and
 * takes tens of seconds. Never called on boot; it exists for the Settings
 * screen's re-check button and `hive doctor --deep`.
 */
router.post("/health", async (req: Request, res: Response) => {
  const cwd =
    typeof req.body?.cwd === "string" && req.body.cwd
      ? req.body.cwd
      : process.cwd();
  try {
    const probes = await checkStreamContracts(config(), cwd);
    res.json({
      probes,
      healthy: probes.every((p) => !p.installed || p.streamOk),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Health check failed",
    });
  }
});

export default router;
