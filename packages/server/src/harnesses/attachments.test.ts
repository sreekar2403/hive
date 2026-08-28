import { describe, it, expect } from "vitest";
import type { HarnessAttachment } from "@hive/shared/harness";
import {
  attachmentPreamble,
  inlineForDirectApi,
  isImage,
  opencodeFileArgs,
  splitForCodex,
} from "./attachments";

const png: HarnessAttachment = {
  path: "C:/tmp/a/screenshot.png",
  name: "screenshot.png",
  mimeType: "image/png",
};
const csv: HarnessAttachment = {
  path: "C:/tmp/b/rows.csv",
  name: "rows.csv",
  mimeType: "text/csv",
};

describe("isImage", () => {
  it("recognises the types these CLIs accept", () => {
    for (const mimeType of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]) {
      expect(isImage({ ...png, mimeType }), mimeType).toBe(true);
    }
  });

  it("falls back to the filename when the browser sent no type", () => {
    expect(isImage({ ...png, mimeType: "" })).toBe(true);
    expect(isImage({ ...csv, mimeType: "" })).toBe(false);
  });

  it("does not treat a document as an image", () => {
    expect(isImage(csv)).toBe(false);
  });
});

describe("attachmentPreamble", () => {
  it("is empty when nothing is attached", () => {
    expect(attachmentPreamble(undefined)).toBe("");
    expect(attachmentPreamble([])).toBe("");
  });

  it("names each file with an absolute path", () => {
    const text = attachmentPreamble([png, csv]);
    expect(text).toContain("C:/tmp/a/screenshot.png");
    expect(text).toContain("C:/tmp/b/rows.csv");
    expect(text).toContain("screenshot.png (image)");
    expect(text).toContain("rows.csv (text/csv)");
  });

  it("says the files are part of the request, not background", () => {
    expect(attachmentPreamble([png])).toContain("part of the request");
  });
});

describe("opencodeFileArgs", () => {
  it("passes every attachment natively, whatever its type", () => {
    expect(opencodeFileArgs([png, csv])).toEqual([
      "--file",
      "C:/tmp/a/screenshot.png",
      "--file",
      "C:/tmp/b/rows.csv",
    ]);
  });

  it("adds nothing when there is nothing attached", () => {
    expect(opencodeFileArgs(undefined)).toEqual([]);
  });
});

describe("splitForCodex", () => {
  it("sends images through --image and leaves the rest for the prompt", () => {
    // A CSV handed to --image fails the run outright, which is why this
    // splits rather than passing everything.
    const { imageArgs, rest } = splitForCodex([png, csv]);
    expect(imageArgs).toEqual(["--image", "C:/tmp/a/screenshot.png"]);
    expect(rest).toEqual([csv]);
  });

  it("leaves nothing behind when everything is an image", () => {
    expect(splitForCodex([png]).rest).toEqual([]);
  });
});

describe("inlineForDirectApi", () => {
  const read = (path: string) => {
    if (path.endsWith(".csv")) return Buffer.from("a,b\n1,2\n");
    if (path.endsWith(".png")) return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    throw new Error("ENOENT");
  };

  it("inlines text, because these harnesses cannot open a path", () => {
    const result = inlineForDirectApi([csv], read);
    expect(result.text).toContain("a,b");
    expect(result.text).toContain("--- rows.csv ---");
  });

  it("hands images over as base64 rather than as a path", () => {
    const result = inlineForDirectApi([png], read);
    expect(result.images).toEqual([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
    ]);
    expect(result.text).toBe("");
  });

  it("says a file is unavailable rather than letting it be invented", () => {
    const missing = {
      path: "C:/tmp/gone.txt",
      name: "gone.txt",
      mimeType: "text/plain",
    };
    expect(inlineForDirectApi([missing], read).text).toContain(
      "could not be read, and is not available to you",
    );
  });

  it("truncates a file too large to inline, and says it did", () => {
    const huge = () => Buffer.from("x".repeat(25000));
    const result = inlineForDirectApi([csv], huge);
    expect(result.text).toContain("truncated");
    expect(result.text.length).toBeLessThan(21000);
  });

  it("does nothing when there is nothing attached", () => {
    expect(inlineForDirectApi(undefined, read)).toEqual({
      text: "",
      images: [],
    });
  });
});
