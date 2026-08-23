import { Router, Request, Response } from "express";

/**
 * STUB — owned by the "logs" workstream. Replace with the real
 * implementation; the mount point in server.ts is already wired.
 */
const router: Router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented yet", surface: "logs" });
});

export default router;
