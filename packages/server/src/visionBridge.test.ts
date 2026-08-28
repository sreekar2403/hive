import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  Harness,
  HarnessAttachment,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { describeImagesFor } from "./visionBridge";
import { looksLikeRefusal } from "./refusal";
import * as catalog from "./models/catalog";

const png: HarnessAttachment = {
  path: "C:/tmp/shot.png",
  name: "shot.png",
  mimeType: "image/png",
};
const csv: HarnessAttachment = {
  path: "C:/tmp/rows.csv",
  name: "rows.csv",
  mimeType: "text/csv",
};

/** Records what it was asked, so the describe pass can be asserted on. */
function harnessThatSees(answer = "A red error banner reading ECONNREFUSED.") {
  const calls: Array<{ prompt: string; options?: HarnessOptions }> = [];
  const harness: Harness & { calls: typeof calls } = {
    name: "seer",
    calls,
    isAvailable: async () => true,
    isCompatible: () => true,
    async execute(prompt, options): Promise<HarnessExecutionResult> {
      calls.push({ prompt, options });
      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: answer,
        filesChanged: [],
        duration: 1,
        events: [],
      };
    },
  };
  return harness;
}

function fakeCatalog(
  options: Array<{
    id: string;
    harness: string;
    model: string;
    ref: string;
    vision: boolean | null;
  }>,
) {
  vi.spyOn(catalog, "getCatalog").mockResolvedValue({
    sources: [],
    generatedAt: Date.now(),
    options: options.map((o) => ({
      ...o,
      provider: "p",
      contextLabel: null,
      thinking: null,
    })),
  } as never);
}

const BLIND = {
  id: "seer/p/blind",
  harness: "seer",
  model: "blind",
  ref: "blind",
  vision: false,
};
const SEEING = {
  id: "seer/p/eyes",
  harness: "seer",
  model: "eyes",
  ref: "eyes",
  vision: true,
};
const UNKNOWN = {
  id: "seer/p/dunno",
  harness: "seer",
  model: "dunno",
  ref: "dunno",
  vision: null,
};

beforeEach(() => fakeCatalog([BLIND, SEEING, UNKNOWN]));
afterEach(() => vi.restoreAllMocks());

describe("describeImagesFor", () => {
  const harnesses = () =>
    new Map<string, Harness>([["seer", harnessThatSees()]]);

  it("does nothing when nothing is an image", async () => {
    const result = await describeImagesFor([csv], {
      harnesses: harnesses(),
      harness: "seer",
      model: "blind",
    });
    expect(result.preamble).toBe("");
  });

  it("does nothing when the working model can see for itself", async () => {
    const map = harnesses();
    const result = await describeImagesFor([png], {
      harnesses: map,
      harness: "seer",
      model: "eyes",
    });
    expect(result.preamble).toBe("");
    expect(
      (map.get("seer") as ReturnType<typeof harnessThatSees>).calls,
    ).toHaveLength(0);
  });

  /* null is "nobody could tell us", not "no" — see modelCanSee. */
  it("leaves an unclassified model alone rather than degrading it", async () => {
    const result = await describeImagesFor([png], {
      harnesses: harnesses(),
      harness: "seer",
      model: "dunno",
    });
    expect(result.preamble).toBe("");
  });

  it("describes the image when the working model is blind", async () => {
    const map = harnesses();
    const result = await describeImagesFor([png], {
      harnesses: map,
      harness: "seer",
      model: "blind",
    });

    expect(result.preamble).toContain("ECONNREFUSED");
    expect(result.preamble).toContain("shot.png");
    expect(result.described).toEqual([png]);
  });

  it("tells the agent it is reading a description, not looking at the image", async () => {
    const result = await describeImagesFor([png], {
      harnesses: harnesses(),
      harness: "seer",
      model: "blind",
    });
    expect(result.preamble).toContain("transcription, not the image itself");
  });

  it("sends the image to the describing model, not the prompt", async () => {
    const map = harnesses();
    await describeImagesFor([png], {
      harnesses: map,
      harness: "seer",
      model: "blind",
    });
    const [call] = (map.get("seer") as ReturnType<typeof harnessThatSees>)
      .calls;
    expect(call.options?.attachments).toEqual([png]);
    expect(call.options?.model).toBe("eyes");
  });

  it("uses the model chosen in settings over the one it would pick", async () => {
    fakeCatalog([
      BLIND,
      SEEING,
      { ...UNKNOWN, id: "seer/p/chosen", model: "chosen", ref: "chosen" },
    ]);
    const map = harnesses();
    await describeImagesFor([png], {
      harnesses: map,
      harness: "seer",
      model: "blind",
      preferred: "seer/p/chosen",
    });
    const [call] = (map.get("seer") as ReturnType<typeof harnessThatSees>)
      .calls;
    expect(call.options?.model).toBe("chosen");
  });

  it("falls back rather than failing when the chosen model is gone", async () => {
    const map = harnesses();
    await describeImagesFor([png], {
      harnesses: map,
      harness: "seer",
      model: "blind",
      preferred: "seer/p/uninstalled",
    });
    const [call] = (map.get("seer") as ReturnType<typeof harnessThatSees>)
      .calls;
    expect(call.options?.model).toBe("eyes");
  });

  it("describes anyway when asked to always", async () => {
    const map = harnesses();
    const result = await describeImagesFor([png], {
      harnesses: map,
      harness: "seer",
      model: "eyes",
      always: true,
    });
    expect(result.preamble).toContain("ECONNREFUSED");
  });

  it("says images are unreadable rather than letting them be invented", async () => {
    fakeCatalog([BLIND]);
    const result = await describeImagesFor([png], {
      harnesses: harnesses(),
      harness: "seer",
      model: "blind",
    });
    expect(result.preamble).toContain("can read them");
    expect(result.preamble).toContain("rather than guessing");
  });

  it("reports a describer that failed instead of pretending it worked", async () => {
    const broken: Harness = {
      name: "seer",
      isAvailable: async () => true,
      isCompatible: () => true,
      execute: async () => {
        throw new Error("model exploded");
      },
    };
    const result = await describeImagesFor([png], {
      harnesses: new Map([["seer", broken]]),
      harness: "seer",
      model: "blind",
    });
    expect(result.preamble).toContain("could not be described");
    expect(result.described).toEqual([]);
  });
});

/**
 * A refusal arrives as a *successful* run: exit 0, real text, saying the
 * model cannot see. It was being passed into a block labelled "this is what
 * the image contains", where the working agent would read
 * "does not support image input" as a fact about the picture.
 *
 * Seen for real: Ollama reports ornith-1.5 as vision-capable and it is, but
 * opencode gates image input on its own per-model config, which the Ollama
 * provider block did not set. The model can see; that route to it could not.
 */
describe("looksLikeRefusal", () => {
  it("catches a model saying it cannot read the image", () => {
    for (const text of [
      'Cannot read "checker.png" — this model does not support image input.',
      "I can't see images.",
      "I am unable to view the attached screenshot.",
      "Sorry, I do not have the ability to process images.",
      "I cannot open the file you attached.",
    ]) {
      expect(looksLikeRefusal(text), text).toBe(true);
    }
  });

  it("does not discard a real description", () => {
    for (const text of [
      "Three equal horizontal bands: red on top, green in the middle, and blue at the bottom.",
      "A screenshot of a terminal. No text in this image is legible at this size.",
      "A photograph of a whiteboard covered in handwriting.",
      "A checkerboard pattern of alternating black and white squares.",
    ]) {
      expect(looksLikeRefusal(text), text).toBe(false);
    }
  });

  /* A long answer that discusses images is a description, not a refusal. */
  it("does not mistake a detailed description for a refusal", () => {
    const long =
      "A screenshot of a settings page. The user cannot see the password field because it is masked. " +
      "x".repeat(700);
    expect(looksLikeRefusal(long)).toBe(false);
  });
});
