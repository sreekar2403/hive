import { describe, it, expect } from "vitest";
import { HARNESS_IDS } from "../config";
import { PERSONA_POOL, personaFor } from "./agents";

/**
 * Every harness gets its own name on the Office floor.
 *
 * This exists because it silently stopped being true: three harnesses had
 * name pools and nine did not, so the nine all fell through to the shared
 * fallback and each took its first entry. Codex, Gemini and Crush were all
 * "Hazel" at once — visible on screen, invisible to every test.
 *
 * The failure mode is adding a CLI and forgetting this file, so the
 * coverage check is driven off HARNESS_IDS rather than a hand-written list.
 */

describe("Office persona names", () => {
  it("gives every supported harness its own pool", () => {
    const missing = HARNESS_IDS.filter((id) => !PERSONA_POOL[id]);
    expect(
      missing,
      `harnesses with no persona pool: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("never gives two harnesses the same name in the same seat", () => {
    for (const seat of [0, 1, 2]) {
      const seen = new Map<string, string>();
      for (const id of HARNESS_IDS) {
        const name = personaFor(id, seat);
        const clash = seen.get(name);
        expect(
          clash,
          `seat ${seat}: ${id} and ${clash} are both "${name}"`,
        ).toBeUndefined();
        seen.set(name, id);
      }
    }
  });

  it("gives concurrent tasks on one harness distinct names", () => {
    const names = [0, 1, 2].map((seat) => personaFor("opencode", seat));
    expect(new Set(names).size).toBe(3);
  });

  it("keeps a name stable for a given harness and seat", () => {
    expect(personaFor("codex", 0)).toBe(personaFor("codex", 0));
    expect(personaFor("codex", 1)).not.toBe(personaFor("codex", 0));
  });

  it("numbers the laps once a pool is exhausted", () => {
    const pool = PERSONA_POOL.opencode;
    expect(personaFor("opencode", pool.length)).toBe(`${pool[0]} 2`);
    expect(personaFor("opencode", pool.length * 2)).toBe(`${pool[0]} 3`);
  });

  it("separates unknown harnesses instead of collapsing them onto one name", () => {
    // The exact names don't matter; not colliding does. Two CLIs Hive has
    // never heard of must not both become the first fallback entry.
    const a = personaFor("some-new-cli", 0);
    const b = personaFor("another-new-cli", 0);
    const c = personaFor("a-third-new-cli", 0);

    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("still gives an unknown harness distinct names per seat", () => {
    const names = [0, 1, 2].map((seat) => personaFor("some-new-cli", seat));
    expect(new Set(names).size).toBe(3);
  });

  it("never returns an empty name", () => {
    for (const id of [...HARNESS_IDS, "totally-unknown"]) {
      for (const seat of [0, 1, 5, 12]) {
        expect(personaFor(id, seat).trim().length).toBeGreaterThan(0);
      }
    }
  });
});
