import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SoulStore } from "./soul";
import { buildStarterSoul } from "./starterSoul";

/**
 * The shape `GET /api/brain/soul/:scope` returns.
 *
 * This exists because of a bug that cost real confusion: the endpoint hands
 * back a `Soul`, whose text lives in `raw`, while two separate editors in
 * the client read `.content`. Neither threw — they rendered an empty box and
 * a placeholder reading "soul.md is empty so far", which is a convincing way
 * to report a file that exists and has content.
 *
 * A silent empty string is the worst possible failure for this field, so the
 * field name is pinned here rather than left to a type that only the server
 * half of the codebase checks.
 */

function tempStore(): { root: string; store: SoulStore; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hive-soul-"));
  return {
    root,
    store: new SoulStore([{ scope: "global", root }]),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("Soul read shape", () => {
  it("carries the file's text in `raw`, not `content`", () => {
    const { store, cleanup } = tempStore();
    try {
      const written = buildStarterSoul({
        scope: "global",
        harnesses: ["opencode"],
        routerModel: "claude-code/anthropic/haiku",
      });
      store.write("global", written);

      const soul = store.read("global");

      expect(soul.raw).toBe(written);
      expect(soul.raw.length).toBeGreaterThan(0);
      // The name a client would reach for, and must not find silently empty.
      expect("content" in soul).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("reports where the file is, so a caller can tell the user", () => {
    const { root, store, cleanup } = tempStore();
    try {
      store.write("global", "# Soul\n");
      const soul = store.read("global");

      expect(soul.path).toBe(path.join(root, "soul.md"));
      expect(soul.exists).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("returns the template and exists:false before anything is written", () => {
    const { store, cleanup } = tempStore();
    try {
      const soul = store.read("global");

      // A caller must be able to tell "nothing here yet" from "empty file" —
      // the setup flow uses exactly this to decide whether to seed.
      expect(soul.exists).toBe(false);
      expect(soul.raw).toContain("# Soul");
    } finally {
      cleanup();
    }
  });

  it("round-trips a starter soul through write and read unchanged", () => {
    const { store, cleanup } = tempStore();
    try {
      const written = buildStarterSoul({
        scope: "global",
        harnesses: ["opencode", "claude-code", "codex"],
        routerModel: "",
      });
      store.write("global", written);

      expect(store.read("global").raw).toBe(written);
    } finally {
      cleanup();
    }
  });

  it("readAll returns an array — the unscoped endpoint's shape", () => {
    const { store, cleanup } = tempStore();
    try {
      const all = store.readAll();

      // The Settings editor called the unscoped endpoint and read `.content`
      // off this array. Pinning the shape makes that mistake visible.
      expect(Array.isArray(all)).toBe(true);
      expect(all[0].scope).toBe("global");
    } finally {
      cleanup();
    }
  });
});
