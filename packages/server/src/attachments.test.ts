import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  findAttachment,
  guessMimeType,
  pruneAttachments,
  resolveAttachments,
  safeFileName,
  setAttachmentRootForTests,
  storeAttachment,
  MAX_ATTACHMENT_BYTES,
} from "./attachments";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hive-attach-test-"));
beforeEach(() => setAttachmentRootForTests(root));
afterAll(() => {
  setAttachmentRootForTests(null);
  fs.rmSync(root, { recursive: true, force: true });
});

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("safeFileName", () => {
  /* The name comes from a browser and is used to build a path. */
  it("refuses to let a name escape the attachment directory", () => {
    expect(safeFileName("../../.ssh/authorized_keys")).toBe("authorized_keys");
    expect(safeFileName(String.raw`..\..\windows\system32\evil.dll`)).toBe(
      "evil.dll",
    );
    expect(safeFileName("/etc/passwd")).toBe("passwd");
  });

  it("never returns something empty that would resolve to the directory", () => {
    expect(safeFileName("...")).toBe("attachment");
    expect(safeFileName("")).toBe("attachment");
    expect(safeFileName("/")).toBe("attachment");
  });

  it("keeps an ordinary name intact", () => {
    expect(safeFileName("screenshot 2026.png")).toBe("screenshot 2026.png");
  });
});

describe("storeAttachment", () => {
  it("writes the file and reports where it went", () => {
    const stored = storeAttachment({ name: "notes.md", data: b64("# hi") });
    expect(fs.readFileSync(stored.path, "utf8")).toBe("# hi");
    expect(stored.name).toBe("notes.md");
    expect(stored.size).toBe(4);
  });

  it("accepts a data: URL, which is what a paste gives you", () => {
    const stored = storeAttachment({
      name: "a.png",
      mimeType: "image/png",
      data: `data:image/png;base64,${b64("PNGDATA")}`,
    });
    expect(fs.readFileSync(stored.path, "utf8")).toBe("PNGDATA");
  });

  it("keeps two files of the same name apart", () => {
    const first = storeAttachment({ name: "same.txt", data: b64("one") });
    const second = storeAttachment({ name: "same.txt", data: b64("two") });
    expect(first.path).not.toBe(second.path);
    expect(fs.readFileSync(first.path, "utf8")).toBe("one");
    expect(fs.readFileSync(second.path, "utf8")).toBe("two");
  });

  it("stores outside the project, so an agent's diff stays its own work", () => {
    const stored = storeAttachment({ name: "x.txt", data: b64("x") });
    expect(stored.path.startsWith(root)).toBe(true);
  });

  it("refuses an empty attachment", () => {
    expect(() => storeAttachment({ name: "x", data: "" })).toThrow(/empty/i);
  });

  it("refuses one over the size limit", () => {
    const tooBig = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1024).toString("base64");
    expect(() => storeAttachment({ name: "big.bin", data: tooBig })).toThrow(
      /limit/i,
    );
  });
});

describe("findAttachment", () => {
  it("reads a stored attachment back", () => {
    const stored = storeAttachment({ name: "spec.md", data: b64("body") });
    expect(findAttachment(stored.id)?.name).toBe("spec.md");
  });

  it("returns nothing for an id that was never stored", () => {
    expect(findAttachment("11111111-1111-1111-1111-111111111111")).toBeNull();
  });

  /* The id becomes a path segment, so it must be exactly a uuid. */
  it("refuses an id that is a traversal attempt", () => {
    expect(findAttachment("../../../etc")).toBeNull();
    expect(findAttachment("..")).toBeNull();
  });
});

describe("resolveAttachments", () => {
  it("resolves the ids a request sent", () => {
    const a = storeAttachment({ name: "a.txt", data: b64("a") });
    const b = storeAttachment({ name: "b.txt", data: b64("b") });
    expect(resolveAttachments([a.id, b.id]).map((x) => x.name)).toEqual([
      "a.txt",
      "b.txt",
    ]);
  });

  it("skips ids that have expired rather than failing the message", () => {
    const a = storeAttachment({ name: "a.txt", data: b64("a") });
    const resolved = resolveAttachments([
      a.id,
      "11111111-1111-1111-1111-111111111111",
    ]);
    expect(resolved).toHaveLength(1);
  });

  it("ignores anything that is not a list of strings", () => {
    expect(resolveAttachments(undefined)).toEqual([]);
    expect(resolveAttachments("nope")).toEqual([]);
    expect(resolveAttachments([1, null, {}])).toEqual([]);
  });
});

describe("pruneAttachments", () => {
  it("removes what has aged out and keeps what has not", () => {
    const old = storeAttachment({ name: "old.txt", data: b64("old") });
    const fresh = storeAttachment({ name: "fresh.txt", data: b64("fresh") });

    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.dirname(old.path), past, past);

    expect(pruneAttachments(30_000)).toBeGreaterThanOrEqual(1);
    expect(findAttachment(old.id)).toBeNull();
    expect(findAttachment(fresh.id)).not.toBeNull();
  });
});

describe("guessMimeType", () => {
  it("knows the common ones", () => {
    expect(guessMimeType("a.png")).toBe("image/png");
    expect(guessMimeType("a.CSV")).toBe("text/csv");
  });

  it("says nothing rather than guessing wrong", () => {
    expect(guessMimeType("a.xyz")).toBe("");
  });
});
