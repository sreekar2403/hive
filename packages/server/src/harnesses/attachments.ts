import type { HarnessAttachment } from "@hive/shared/harness";

/**
 * Getting an attached file in front of an agent, whichever CLI it is.
 *
 * There is no common mechanism. opencode takes `--file` and accepts
 * anything; Codex takes `--image` and accepts only images; Claude Code,
 * Gemini, aider and the rest have no attachment flag at all.
 *
 * What every one of them does have is a file-reading tool and a filesystem
 * they can see. So the fallback is not a refusal or a silent drop — it is
 * telling the agent, in the prompt, exactly where the file is and what it
 * is. That works for images too on the CLIs whose models can see them, and
 * degrades to "the agent knows a file it cannot open exists" on the ones
 * that can't, which is still better than pretending nothing was attached.
 */

/** Images, by the mime types these CLIs actually accept. */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;

export function isImage(attachment: HarnessAttachment): boolean {
  if (IMAGE_TYPES.test(attachment.mimeType)) return true;
  // A browser that sent no type still gives us the name to go on.
  return /\.(png|jpe?g|gif|webp)$/i.test(attachment.name);
}

/**
 * The block naming each attachment for a CLI with no flag for them.
 *
 * Absolute paths, one per line, with the type — an agent told "look at
 * screenshot.png" and nothing else will guess at a relative path and open
 * the wrong file or none. Empty string when there is nothing attached, so
 * callers can concatenate unconditionally.
 */
export function attachmentPreamble(
  attachments: HarnessAttachment[] | undefined,
): string {
  if (!attachments?.length) return "";

  const lines = [
    attachments.length === 1
      ? "=== Attached file ==="
      : "=== Attached files ===",
    "The person attached these to their message. Read them before you start; they are part of the request, not background.",
  ];

  for (const attachment of attachments) {
    const kind = isImage(attachment) ? "image" : attachment.mimeType || "file";
    lines.push(`- ${attachment.name} (${kind}): ${attachment.path}`);
  }

  lines.push("=== End attached files ===", "");
  return lines.join("\n");
}

/**
 * `--file a --file b`, opencode's form. It takes any file type, so every
 * attachment goes through natively and nothing needs naming in the prompt.
 */
export function opencodeFileArgs(
  attachments: HarnessAttachment[] | undefined,
): string[] {
  const args: string[] = [];
  for (const attachment of attachments ?? []) {
    args.push("--file", attachment.path);
  }
  return args;
}

/**
 * Codex's `--image`, which is images only.
 *
 * Splitting the list is the point: images go through the flag, and whatever
 * is left still has to reach the agent somehow, so the caller puts those in
 * the prompt. Sending a CSV to `--image` fails the run outright.
 */
export function splitForCodex(attachments: HarnessAttachment[] | undefined): {
  imageArgs: string[];
  rest: HarnessAttachment[];
} {
  const imageArgs: string[] = [];
  const rest: HarnessAttachment[] = [];

  for (const attachment of attachments ?? []) {
    if (isImage(attachment)) imageArgs.push("--image", attachment.path);
    else rest.push(attachment);
  }

  return { imageArgs, rest };
}

/* ------------------------------------------------------------------ */
/* Direct HTTP harnesses                                               */
/* ------------------------------------------------------------------ */

/**
 * How much of a text attachment is inlined before it is cut.
 *
 * These harnesses have no tools, so whatever is inlined is all the model
 * will ever see of the file — but a 5 MB CSV pasted into a prompt buys a
 * context-length error rather than an answer.
 */
const INLINE_TEXT_LIMIT = 20000;

export interface DirectImage {
  /** Base64, with no data: prefix — that is Ollama's `images` field. */
  data: string;
  /**
   * The real type, carried so a caller that needs a data: URL can build a
   * truthful one. Labelling a JPEG as image/png is the kind of thing a
   * strict endpoint rejects and a lenient one silently mis-decodes.
   */
  mimeType: string;
}

export interface DirectAttachments {
  /** Prepended to the prompt: file contents, or a note about what wasn't. */
  text: string;
  images: DirectImage[];
}

/**
 * Attachments for a harness that talks to a model over HTTP.
 *
 * ollamaDirect and lmstudioDirect are not CLIs. They have no shell, no file
 * tool and no working directory, so the path-naming fallback the CLI
 * adapters use would be worse than useless here: it invites the model to
 * claim it read a file it has no way to open.
 *
 * Text is therefore inlined outright, and images are handed over as base64
 * for the caller to pass through its provider's own image field. A file
 * that can be neither inlined nor decoded is *named as unavailable*, which
 * is the one thing that reliably stops a model inventing its contents.
 */
export function inlineForDirectApi(
  attachments: HarnessAttachment[] | undefined,
  read: (path: string) => Buffer,
): DirectAttachments {
  if (!attachments?.length) return { text: "", images: [] };

  const images: DirectImage[] = [];
  const blocks: string[] = [];

  for (const attachment of attachments) {
    let buffer: Buffer;
    try {
      buffer = read(attachment.path);
    } catch {
      blocks.push(
        `[${attachment.name} could not be read, and is not available to you.]`,
      );
      continue;
    }

    if (isImage(attachment)) {
      images.push({
        data: buffer.toString("base64"),
        mimeType: attachment.mimeType || guessImageType(attachment.name),
      });
      continue;
    }

    const text = buffer.toString("utf8");
    const clipped =
      text.length > INLINE_TEXT_LIMIT
        ? `${text.slice(0, INLINE_TEXT_LIMIT)}\n[…truncated, ${text.length - INLINE_TEXT_LIMIT} more characters]`
        : text;

    blocks.push(
      `--- ${attachment.name} ---\n${clipped}\n--- end ${attachment.name} ---`,
    );
  }

  const text = blocks.length
    ? `=== Attached files ===\n${blocks.join("\n\n")}\n=== End attached files ===\n\n`
    : "";

  return { text, images };
}

/** Falls back to the extension when the browser sent no type. */
function guessImageType(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}
