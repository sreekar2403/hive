import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RecordStore, slugify } from "./store";
import type { BrainScope } from "./types";

/**
 * The record store is the layer everything else in the Second Brain reads
 * through, so these pin the two behaviours the rest of the code assumes:
 * project scope shadows global, and repeated observation moves confidence
 * gradually rather than in one jump.
 */
describe("RecordStore", () => {
  let tmp: string;
  let scopes: Array<{ scope: BrainScope; root: string }>;
  let store: RecordStore;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hive-brain-"));
    scopes = [
      { scope: "global", root: path.join(tmp, "global") },
      { scope: "project", root: path.join(tmp, "project") },
    ];
    store = new RecordStore(scopes);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reads back nothing from an untouched store", () => {
    expect(store.list()).toEqual([]);
    expect(store.get("anything")).toBeNull();
  });

  it("does not create directories just by being read", () => {
    store.list();
    expect(fs.existsSync(path.join(tmp, "global"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "project"))).toBe(false);
  });

  it("round-trips a record", () => {
    const written = store.put(
      "project",
      { store: "user", shelf: "preferences" },
      { title: "Prefers short commit subjects", confidence: 0.8 },
    );

    expect(written.id).toBe("prefers-short-commit-subjects");
    expect(store.get(written.id)?.title).toBe("Prefers short commit subjects");
    expect(store.list({ store: "user" })).toHaveLength(1);
  });

  it("writes each record as readable JSON on its shelf", () => {
    store.put(
      "project",
      { store: "task", shelf: "failures" },
      { title: "npm install fails offline" },
    );

    const filePath = path.join(
      tmp,
      "project",
      "task",
      "failures",
      "npm-install-fails-offline.json",
    );
    expect(fs.existsSync(filePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, "utf-8")).shelf).toBe(
      "failures",
    );
  });

  describe("scope precedence", () => {
    it("lets a project record shadow a global one with the same id", () => {
      store.put(
        "global",
        { store: "user", shelf: "rules" },
        { id: "style", title: "Global: formal prose" },
      );
      store.put(
        "project",
        { store: "user", shelf: "rules" },
        { id: "style", title: "This repo: terse prose" },
      );

      const found = store.list({ store: "user" });
      expect(found).toHaveLength(1);
      expect(found[0].title).toBe("This repo: terse prose");
    });

    it("still returns global records the project has nothing to say about", () => {
      store.put(
        "global",
        { store: "user", shelf: "rules" },
        { id: "only-global", title: "Global only" },
      );
      expect(store.list().map((r) => r.id)).toEqual(["only-global"]);
    });
  });

  describe("accumulating evidence", () => {
    it("counts samples across repeated observations", () => {
      const ref = { store: "task", shelf: "routing" } as const;
      store.put("project", ref, { id: "r", title: "first" });
      store.put("project", ref, { id: "r", title: "second" });
      const third = store.put("project", ref, { id: "r", title: "third" });

      expect(third.samples).toBe(3);
      expect(third.title).toBe("third");
    });

    it("eases confidence toward each new observation instead of jumping", () => {
      const ref = { store: "task", shelf: "routing" } as const;
      const first = store.put("project", ref, {
        id: "r",
        title: "t",
        confidence: 0.3,
      });
      expect(first.confidence).toBeCloseTo(0.3, 5);

      // A single contradicting observation must not swing the record: it
      // moves a third of the way, so 0.3 -> 0.5, not 0.3 -> 0.9.
      const second = store.put("project", ref, {
        id: "r",
        title: "t",
        confidence: 0.9,
      });
      expect(second.confidence).toBeCloseTo(0.5, 5);
    });

    it("keeps an approved record approved through later observations", () => {
      const ref = { store: "user", shelf: "rules" } as const;
      store.put("project", ref, { id: "r", title: "t", approved: true });
      expect(store.put("project", ref, { id: "r", title: "t" }).approved).toBe(
        true,
      );
    });

    it("clears approval when asked explicitly", () => {
      const ref = { store: "user", shelf: "rules" } as const;
      store.put("project", ref, { id: "r", title: "t", approved: true });
      const cleared = store.put("project", ref, {
        id: "r",
        title: "t",
        approved: false,
      });
      expect(cleared.approved).toBe(false);
    });
  });

  describe("filtering", () => {
    beforeEach(() => {
      store.put(
        "project",
        { store: "task", shelf: "strategies" },
        {
          id: "s1",
          title: "opencode is good at tests",
          category: "test",
          harness: "opencode",
          confidence: 0.9,
          tags: ["vitest"],
        },
      );
      store.put(
        "project",
        { store: "task", shelf: "strategies" },
        {
          id: "s2",
          title: "claude-code is good at refactors",
          category: "refactor",
          harness: "claude-code",
          confidence: 0.9,
        },
      );
      store.put(
        "project",
        { store: "task", shelf: "strategies" },
        {
          id: "s3",
          title: "applies anywhere",
          category: null,
          confidence: 0.5,
        },
      );
    });

    it("filters by category", () => {
      const ids = store.list({ category: "test" }).map((r) => r.id);
      expect(ids).toContain("s1");
      expect(ids).not.toContain("s2");
    });

    it("keeps category-less records in every category's results", () => {
      // A record with no category means "applies everywhere" — dropping it
      // would silently lose the user's most general preferences.
      expect(store.list({ category: "refactor" }).map((r) => r.id)).toContain(
        "s3",
      );
    });

    it("filters by minimum confidence", () => {
      const ids = store.list({ minConfidence: 0.8 }).map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining(["s1", "s2"]));
      expect(ids).not.toContain("s3");
    });

    it("ranks an exact category match above a general record", () => {
      const [first] = store.list({ category: "test" });
      expect(first.id).toBe("s1");
    });

    it("honours limit", () => {
      expect(store.list({ limit: 2 })).toHaveLength(2);
    });
  });

  it("skips a corrupt record rather than throwing", () => {
    store.put(
      "project",
      { store: "user", shelf: "rules" },
      { id: "good", title: "fine" },
    );
    fs.writeFileSync(
      path.join(tmp, "project", "user", "rules", "bad.json"),
      "{ not json",
      "utf-8",
    );

    expect(store.list().map((r) => r.id)).toEqual(["good"]);
  });

  it("removes a record from a scope", () => {
    const ref = { store: "user", shelf: "rules" } as const;
    store.put("project", ref, { id: "gone", title: "x" });

    expect(store.remove("project", ref, "gone")).toBe(true);
    expect(store.remove("project", ref, "gone")).toBe(false);
    expect(store.get("gone")).toBeNull();
  });

  it("rejects an id that would escape the store directory", () => {
    // Ids become path segments, exactly as session ids do in SharedMemory.
    const unsafe = store.put(
      "project",
      { store: "user", shelf: "rules" },
      { id: "../../escape", title: "Escape attempt" },
    );
    expect(unsafe.id).toBe("escape-attempt");
    expect(fs.existsSync(path.join(tmp, "project", "user", "rules"))).toBe(
      true,
    );
  });
});

describe("slugify", () => {
  it("produces filesystem-safe ids", () => {
    expect(slugify("Prefers bullet points!")).toBe("prefers-bullet-points");
    expect(slugify("  --weird-- ")).toBe("weird");
  });

  it("falls back when there is nothing to slug", () => {
    expect(slugify("!!!", "fallback")).toBe("fallback");
  });
});
