import { Router, Request, Response } from "express";
import type { SharedMemory } from "../sharedMemory";

/**
 * Shared-memory browsing API. The store is owned by HiveServer, so it is
 * injected here at startup rather than constructed per-request.
 */
const router: Router = Router();

let memory: SharedMemory | null = null;

export function setSharedMemory(store: SharedMemory): void {
  memory = store;
}

// Session ids and keys become filesystem path segments inside SharedMemory,
// so reject anything that isn't a plain safe token before it gets there.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
function isValidId(id: string): boolean {
  return SAFE_ID.test(id) && id !== "." && id !== "..";
}

function requireMemory(res: Response): SharedMemory | null {
  if (!memory) {
    res.status(503).json({ error: "Memory store unavailable" });
    return null;
  }
  return memory;
}

const PREVIEW_LENGTH = 200;

/** GET /api/memory/sessions — every session with entry count, size, last activity. */
// Registered before "/:sessionId" — otherwise Express would treat the literal
// path segment "sessions" as a session id.
router.get("/sessions", async (_req: Request, res: Response) => {
  const store = requireMemory(res);
  if (!store) return;
  const sessions = await store.listSessions();
  res.json(sessions);
});

/** GET /api/memory/:sessionId — entries for a session (key, size, updated, preview). */
router.get("/:sessionId", async (req: Request, res: Response) => {
  const store = requireMemory(res);
  if (!store) return;

  const { sessionId } = req.params;
  if (!isValidId(sessionId)) {
    return res.status(400).json({ error: "Invalid session id" });
  }

  const entries = await store.list(sessionId);
  res.json(
    entries.map((entry) => ({
      key: entry.key,
      size: Buffer.byteLength(entry.value, "utf-8"),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      preview:
        entry.value.length > PREVIEW_LENGTH
          ? entry.value.slice(0, PREVIEW_LENGTH) + "…"
          : entry.value,
    })),
  );
});

/** GET /api/memory/:sessionId/:key — the full entry, including its value. */
router.get("/:sessionId/:key", async (req: Request, res: Response) => {
  const store = requireMemory(res);
  if (!store) return;

  const { sessionId, key } = req.params;
  if (!isValidId(sessionId) || !isValidId(key)) {
    return res.status(400).json({ error: "Invalid session id or key" });
  }

  const entry = await store.get(sessionId, key);
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  res.json(entry);
});

/** PUT /api/memory/:sessionId/:key — create or update a value. Body: { value: string }. */
router.put("/:sessionId/:key", async (req: Request, res: Response) => {
  const store = requireMemory(res);
  if (!store) return;

  const { sessionId, key } = req.params;
  if (!isValidId(sessionId) || !isValidId(key)) {
    return res.status(400).json({ error: "Invalid session id or key" });
  }

  const value = req.body?.value;
  if (typeof value !== "string") {
    return res.status(400).json({ error: '"value" must be a string' });
  }

  await store.set(sessionId, key, value);
  const entry = await store.get(sessionId, key);
  res.json(entry);
});

/** DELETE /api/memory/:sessionId/:key — remove one entry. */
router.delete("/:sessionId/:key", async (req: Request, res: Response) => {
  const store = requireMemory(res);
  if (!store) return;

  const { sessionId, key } = req.params;
  if (!isValidId(sessionId) || !isValidId(key)) {
    return res.status(400).json({ error: "Invalid session id or key" });
  }

  await store.delete(sessionId, key);
  res.status(204).end();
});

/** DELETE /api/memory/:sessionId — clear every entry for a session. */
router.delete("/:sessionId", async (req: Request, res: Response) => {
  const store = requireMemory(res);
  if (!store) return;

  const { sessionId } = req.params;
  if (!isValidId(sessionId)) {
    return res.status(400).json({ error: "Invalid session id" });
  }

  await store.deleteSession(sessionId);
  res.status(204).end();
});

export default router;
