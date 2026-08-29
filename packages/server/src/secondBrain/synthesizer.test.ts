import { describe, it, expect } from "vitest";
import { parseProposals } from "./synthesizer";

describe("parseProposals", () => {
  it("parses a valid JSON array from output", () => {
    const output = `[
  {"section": "Writing style", "entry": "Prefers short sentences", "rationale": "Observed in multiple tasks", "confidence": 0.8}
]`;
    const result = parseProposals(output);
    expect(result).toHaveLength(1);
    expect(result[0].section).toBe("Writing style");
    expect(result[0].entry).toBe("Prefers short sentences");
    expect(result[0].confidence).toBe(0.8);
  });

  it("parses JSON wrapped in code fences", () => {
    const output = `\`\`\`json
[
  {"section": "Writing style", "entry": "Prefers short sentences", "rationale": "Observed", "confidence": 0.8}
]
\`\`\``;
    const result = parseProposals(output);
    expect(result).toHaveLength(1);
    expect(result[0].entry).toBe("Prefers short sentences");
  });

  it("handles JSON with code fence but no language specifier", () => {
    const output = `\`\`\`
[
  {"section": "Writing style", "entry": "Prefers short sentences", "rationale": "Observed", "confidence": 0.8}
]
\`\`\``;
    const result = parseProposals(output);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for empty output", () => {
    expect(parseProposals("")).toEqual([]);
    expect(parseProposals("   ")).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    const output = "This is not JSON at all";
    expect(parseProposals(output)).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    const output = `{"section": "Writing style", "entry": "Prefers short sentences"}`;
    expect(parseProposals(output)).toEqual([]);
  });

  it("filters out entries with invalid section", () => {
    const output = `[
  {"section": "Invalid Section", "entry": "Some entry", "rationale": "Observed", "confidence": 0.8},
  {"section": "Writing style", "entry": "Valid entry", "rationale": "Observed", "confidence": 0.7}
]`;
    const result = parseProposals(output);
    // Invalid section gets defaulted to "Ideation patterns" instead of being filtered out
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.entry)).toContain("Some entry");
    expect(result.map((r) => r.entry)).toContain("Valid entry");
    // The invalid section should be defaulted
    const defaulted = result.find((r) => r.entry === "Some entry");
    expect(defaulted?.section).toBe("Ideation patterns");
  });

  it("defaults invalid section to 'Ideation patterns'", () => {
    const output = `[
  {"section": "Unknown", "entry": "Some entry", "rationale": "Observed", "confidence": 0.8}
]`;
    const result = parseProposals(output);
    expect(result[0].section).toBe("Ideation patterns");
  });

  it("filters out entries with empty entry text", () => {
    const output = `[
  {"section": "Writing style", "entry": "", "rationale": "Observed", "confidence": 0.8},
  {"section": "Writing style", "entry": "Valid entry", "rationale": "Observed", "confidence": 0.7}
]`;
    const result = parseProposals(output);
    expect(result).toHaveLength(1);
    expect(result[0].entry).toBe("Valid entry");
  });

  it("clamps confidence to 0-1 range", () => {
    const output = `[
  {"section": "Writing style", "entry": "Entry 1", "rationale": "Observed", "confidence": 1.5},
  {"section": "Writing style", "entry": "Entry 2", "rationale": "Observed", "confidence": -0.5},
  {"section": "Writing style", "entry": "Entry 3", "rationale": "Observed", "confidence": 0.5}
]`;
    const result = parseProposals(output);
    expect(result[0].confidence).toBe(1);
    expect(result[1].confidence).toBe(0);
    expect(result[2].confidence).toBe(0.5);
  });

  it("handles missing confidence gracefully", () => {
    const output = `[
  {"section": "Writing style", "entry": "Entry 1", "rationale": "Observed"}
]`;
    const result = parseProposals(output);
    expect(result[0].confidence).toBe(0.5);
  });

  it("limits to at most 3 entries", () => {
    const output = `[
  {"section": "Writing style", "entry": "Entry 1", "rationale": "Observed", "confidence": 0.8},
  {"section": "Writing style", "entry": "Entry 2", "rationale": "Observed", "confidence": 0.7},
  {"section": "Writing style", "entry": "Entry 3", "rationale": "Observed", "confidence": 0.6},
  {"section": "Writing style", "entry": "Entry 4", "rationale": "Observed", "confidence": 0.5}
]`;
    const result = parseProposals(output);
    expect(result).toHaveLength(3);
  });

  it("accepts all valid section names", () => {
    const sections = [
      "Writing style",
      "Document preferences",
      "Ideation patterns",
      "Skill choices",
      "UI preferences",
      "Harness preferences",
    ];

    for (const section of sections) {
      const output = `[
  {"section": "${section}", "entry": "Test entry", "rationale": "Observed", "confidence": 0.8}
]`;
      const result = parseProposals(output);
      expect(result[0].section).toBe(section);
    }
  });
});
