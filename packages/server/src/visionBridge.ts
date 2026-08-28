import { Harness } from "@hive/shared/harness";
import type { HarnessAttachment } from "@hive/shared/harness";
import { getCatalog } from "./models/catalog";
import { isImage } from "./harnesses/attachments";
import { log } from "./telemetry";
import { looksLikeRefusal } from "./refusal";

/**
 * Letting a model that cannot see an image work with one anyway.
 *
 * Most models on this machine are blind. Attaching a screenshot to a task
 * running on `qwen2.5-coder:7b` has three possible outcomes: refuse the
 * attachment, pass it and let the model hallucinate what is in it, or send
 * the image to a model that *can* see, and give the working agent the
 * description in words.
 *
 * The third is the only one that is both honest and useful, and it is what
 * this does. A vision model is asked to describe the image in detail, and
 * its answer is prepended to the prompt as a transcription clearly labelled
 * as one — the agent is told it is reading a description rather than
 * looking at the image, because an agent that thinks it saw the screenshot
 * will answer questions about details nobody described to it.
 *
 * Nothing here runs when the working model can see for itself: the image
 * goes straight through, and a description would only be a worse copy of
 * what the model already has.
 */

/**
 * What the describing model is asked for.
 *
 * Factual and not interpretive: the agent receiving this has the actual
 * task, and a describer that decided what mattered would be making that
 * call with none of the context for it.
 *
 * The order of the instructions is doing real work. An earlier version led
 * with "transcribe every error message, label, code, URL and number" and
 * asked for "anything that looks wrong, highlighted or selected" — a prompt
 * written for the screenshot-of-a-broken-app case. Handed an image with no
 * text in it, that primed the model to produce UI-shaped content, and it
 * duly invented some: a 48×48 checkerboard came back as "a nested list of
 * tasks, an arrow pointing to a box, and a status line". The same model,
 * same image, asked plainly what it saw, answered "a checkerboard pattern
 * of alternating black and white squares".
 *
 * So: say what this *is* first, and make transcription conditional on there
 * being something to transcribe. Inventing text is the failure mode worth
 * spending a line to forbid outright, because the description is handed on
 * labelled as a transcription and will be believed.
 */
const DESCRIBE_PROMPT = [
  "Say exactly what is in this image. Someone who cannot see it has to work from your description alone.",
  "",
  "Start with what the image is — a screenshot, a photograph, a diagram, a chart, an abstract pattern, something else — and what it shows.",
  "Then describe the layout, the colours and anything notable about them.",
  "",
  "If the image contains text, transcribe it exactly: error messages, labels, code, URLs and numbers, verbatim.",
  "If it contains no text, say 'No text in this image.' Do not invent text, labels or user-interface elements that are not there.",
  "",
  "Describe only what is actually visible. Do not interpret it, do not guess what it is for, and do not say what should be done about it.",
].join("\n");

export interface VisionBridgeContext {
  harnesses: Map<string, Harness>;
  /** The harness about to run the real task. */
  harness: string;
  /** The model it will run, in the CLI's own notation. */
  model?: string | null;
  /**
   * The catalog id the user chose in Settings, when they chose one.
   * Honoured over anything found automatically: they can see which of
   * their vision models actually reads a screenshot well, and this code
   * cannot.
   */
  preferred?: string | null;
  /** Describe images even when the working model could see them itself. */
  always?: boolean;
  timeoutMs?: number;
}

export interface BridgeResult {
  /** Prepended to the prompt. Empty when nothing needed describing. */
  preamble: string;
  /** Images that were described, and so must not also be sent natively. */
  described: HarnessAttachment[];
}

const EMPTY: BridgeResult = { preamble: "", described: [] };

/**
 * Whether the model about to run can look at an image.
 *
 * An unknown capability counts as "can see". The catalog reports `null`
 * when no source could tell us, and treating that as blind would put every
 * undocumented model through a description pass it may not have needed —
 * degrading a working setup on a guess. A model that cannot see and is
 * asked to look simply says so, which is recoverable; a needless bridge
 * silently replaces the image on every task.
 */
export async function modelCanSee(
  harness: string,
  model: string | null | undefined,
): Promise<boolean> {
  if (!model) return true;
  try {
    const catalog = await getCatalog();
    const match = catalog.options.find(
      (option) =>
        option.harness === harness &&
        (option.ref === model || option.model === model || option.id === model),
    );
    return match?.vision !== false;
  } catch {
    return true;
  }
}

/** A model that can see, preferring one on the harness already in use. */
async function findVisionModel(
  ctx: VisionBridgeContext,
): Promise<{ harness: string; ref: string; id: string } | null> {
  let catalog;
  try {
    catalog = await getCatalog();
  } catch {
    return null;
  }

  const usable = catalog.options.filter(
    (option) => option.vision === true && ctx.harnesses.has(option.harness),
  );

  // The user's choice wins, and is looked up among *all* options rather
  // than only the ones known to have vision: a model the catalog could not
  // classify is still a deliberate choice, and second-guessing it here
  // would make the setting look broken.
  if (ctx.preferred) {
    const picked = catalog.options.find(
      (option) =>
        option.id === ctx.preferred && ctx.harnesses.has(option.harness),
    );
    if (picked) {
      return { harness: picked.harness, ref: picked.ref, id: picked.id };
    }
    log(
      "warn",
      "vision",
      `Configured vision model "${ctx.preferred}" is not available; choosing one instead`,
    );
  }

  if (usable.length === 0) return null;

  // Same harness first: it is known to be installed and working, and it
  // keeps the describe pass on the machine the user already chose.
  const sameHarness = usable.find((option) => option.harness === ctx.harness);
  const chosen = sameHarness ?? usable[0];
  return { harness: chosen.harness, ref: chosen.ref, id: chosen.id };
}

export async function describeImagesFor(
  attachments: HarnessAttachment[] | undefined,
  ctx: VisionBridgeContext,
): Promise<BridgeResult> {
  const images = (attachments ?? []).filter(isImage);
  if (images.length === 0) return EMPTY;

  if (!ctx.always && (await modelCanSee(ctx.harness, ctx.model))) return EMPTY;

  const describer = await findVisionModel(ctx);
  if (!describer) {
    // Say so in the prompt rather than leaving the agent to invent the
    // contents of a file it was told about and cannot open.
    return {
      preamble: [
        "=== Attached images ===",
        `${images.length} image(s) were attached, but neither this model nor any other available one can read them: ${images
          .map((image) => image.name)
          .join(", ")}.`,
        "Ask the person to describe them rather than guessing.",
        "=== End attached images ===",
        "",
      ].join("\n"),
      described: images,
    };
  }

  const harness = ctx.harnesses.get(describer.harness);
  if (!harness) return EMPTY;

  const sections: string[] = ["=== Attached images ==="];
  sections.push(
    `You cannot see images, so each one was described by ${describer.id}. What follows is a transcription, not the image itself — if a detail you need is missing from it, say so rather than assuming.`,
  );

  const described: HarnessAttachment[] = [];

  for (const image of images) {
    let text = "";
    try {
      const result = await harness.execute(DESCRIBE_PROMPT, {
        model: describer.ref,
        attachments: [image],
        timeout: ctx.timeoutMs ?? 180000,
      });
      if (result.success) text = result.output.trim();
    } catch {
      // Falls through to the failure note below.
    }

    // A refusal is not a description, and it arrives as a *successful* run:
    // exit 0, real text, saying the model cannot see. Passing that through
    // is the worst of the options here, because the block it lands in is
    // labelled "this is what the image contains" — the working agent would
    // read "does not support image input" as a fact about the picture.
    //
    // Seen for real: Ollama reports ornith-1.5 as vision-capable and it is,
    // but opencode gates image input on its own per-model config, which the
    // Ollama provider block does not set. The model can see; that route to
    // it cannot. Capability belongs to the harness-and-model pair, not the
    // model alone, and no catalog lookup here would have caught it.
    if (text && looksLikeRefusal(text)) {
      log(
        "warn",
        "vision",
        `${describer.id} refused the image: ${text.slice(0, 120)}`,
      );
      text = "";
    }

    if (text) {
      sections.push("", `--- ${image.name} ---`, text);
      described.push(image);
      log("info", "vision", `Described ${image.name} with ${describer.id}`);
    } else {
      sections.push("", `--- ${image.name} ---`, "(could not be described)");
      log("warn", "vision", `Could not describe ${image.name}`);
    }
  }

  sections.push("=== End attached images ===", "");
  return { preamble: sections.join("\n"), described };
}
export { looksLikeRefusal } from "./refusal";
