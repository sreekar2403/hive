import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  Harness,
  HarnessAttachment,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { describeImagesFor } from "./visionBridge";
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
