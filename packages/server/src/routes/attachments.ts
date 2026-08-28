import { Router, Request, Response } from "express";
import fs from "fs";
import {
  findAttachment,
  storeAttachment,
  MAX_ATTACHMENT_BYTES,
} from "../attachments";

/**
 * Uploading a file to send with a chat message.
 *
 * Base64 JSON rather than multipart, which is a deliberate trade: multipart
 * would mean a new dependency for one endpoint, and the two ways people
 * actually attach a screenshot — pasting and dragging — both hand the
 * browser a Blob that is no harder to base64 than to build a multipart body
 * from. The cost is roughly a third more bytes over localhost, which is not
 * a cost.
 */
const router: Router = Router();

router.post("/", (req: Request, res: Response) => {
  const { name, mimeType, data } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "A file name is required." });
  }
  if (typeof data !== "string" || !data) {
    return res.status(400).json({ error: "File data is required." });
  }

  try {
    const stored = storeAttachment({
      name,
      mimeType: typeof mimeType === "string" ? mimeType : undefined,
      data,
    });
    // The path stays on the server. The client needs the id to send with a
    // message and the metadata to draw a chip; where the bytes landed is
    // not its business and is a filesystem path it should not be handling.
    res.status(201).json({
      id: stored.id,
      name: stored.name,
      mimeType: stored.mimeType,
      size: stored.size,
    });
  } catch (err) {
    // A file that is too large or unreadable is the caller's problem to
    // fix, and the message says which — a bare 500 would not.
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not store the file.",
      maxBytes: MAX_ATTACHMENT_BYTES,
    });
  }
});

/** Serves an attachment back, so the composer can preview what was sent. */
router.get("/:id", (req: Request, res: Response) => {
  const attachment = findAttachment(req.params.id);
  if (!attachment) {
    return res.status(404).json({ error: "That attachment has expired." });
  }

  if (attachment.mimeType) res.type(attachment.mimeType);
  // Never inline: an attachment is arbitrary user-supplied bytes, and an
  // HTML or SVG file rendered inline would run its own script on this
  // origin, next to the token in localStorage.
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${attachment.name}"`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  fs.createReadStream(attachment.path).pipe(res);
});

export default router;
