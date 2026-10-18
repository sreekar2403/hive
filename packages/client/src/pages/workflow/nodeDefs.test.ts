import { describe, it, expect } from "vitest";
import { NODE_DEFS, NODE_CATEGORIES } from "./nodeDefs";

describe("node registry", () => {
  it("exposes 28 defs across 6 categories", () => {
    expect(NODE_DEFS).toHaveLength(28);
    expect(NODE_CATEGORIES).toEqual([
      "Flow control",
      "Work",
      "Agents & chat",
      "Prompts & models",
      "Data & files",
      "Tools & web",
    ]);
  });

  it("gives every kind a unique label and createData", () => {
    const kinds = NODE_DEFS.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(28);
    for (const d of NODE_DEFS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.createData()).toMatchObject({ label: expect.any(String) });
    }
  });
});
