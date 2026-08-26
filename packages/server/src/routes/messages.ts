import { Router, Request, Response } from "express";
import { briefingFor, inbox, send, thread } from "../agentMail";

/**
 * The agent mailbox (see agentMail.ts). Parallel agents work in isolated
 * checkouts, so this is the only way one can tell another what it did.
 */
const router: Router = Router();

// GET /api/messages/:sessionId — the whole session thread
router.get("/:sessionId", (req: Request, res: Response) => {
  try {
    res.json({ messages: thread(req.params.sessionId) });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not read messages",
    });
  }
});

// GET /api/messages/:sessionId/inbox/:taskId — what is waiting for one task
router.get("/:sessionId/inbox/:taskId", (req: Request, res: Response) => {
  const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
  try {
    res.json({
      messages: inbox(req.params.sessionId, req.params.taskId, { unreadOnly }),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not read the inbox",
    });
  }
});

/*
 * GET /api/messages/:sessionId/briefing/:taskId — the inbox as prompt text.
 *
 * Reading it marks those messages read, so this is a POST-shaped GET on
 * purpose: it is what an agent calls once, at the start of its run.
 */
router.post("/:sessionId/briefing/:taskId", (req: Request, res: Response) => {
  try {
    res.json({
      briefing: briefingFor(req.params.sessionId, req.params.taskId),
    });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error ? err.message : "Could not build the briefing",
    });
  }
});

// POST /api/messages/:sessionId — send one
router.post("/:sessionId", (req: Request, res: Response) => {
  const { fromTaskId, fromAgent, toTaskId, subject, body } = req.body ?? {};
  if (typeof fromTaskId !== "string" || !fromTaskId) {
    return res.status(400).json({ error: "fromTaskId is required" });
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return res.status(400).json({ error: "subject is required" });
  }

  try {
    const message = send({
      sessionId: req.params.sessionId,
      fromTaskId,
      fromAgent: typeof fromAgent === "string" ? fromAgent : fromTaskId,
      toTaskId: typeof toTaskId === "string" && toTaskId ? toTaskId : null,
      subject,
      body: typeof body === "string" ? body : "",
    });
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not send the message",
    });
  }
});

export default router;
