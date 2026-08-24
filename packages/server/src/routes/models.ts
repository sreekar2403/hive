import { Router, Request, Response } from "express";
import { getCatalog } from "../models/catalog";

/**
 * What can actually run here. Backed by live discovery — see
 * models/catalog.ts for how each harness and local server is asked.
 */
const router: Router = Router();

// GET /api/models?refresh=1
router.get("/", async (req: Request, res: Response) => {
  const force = req.query.refresh === "1" || req.query.refresh === "true";
  try {
    const catalog = await getCatalog(force);
    res.json(catalog);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not build the catalog",
    });
  }
});

// POST /api/models/refresh — same thing, for a button that means it
router.post("/refresh", async (_req: Request, res: Response) => {
  try {
    res.json(await getCatalog(true));
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error ? err.message : "Could not refresh the catalog",
    });
  }
});

export default router;
