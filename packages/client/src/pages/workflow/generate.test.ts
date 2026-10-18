import { describe, it, expect } from "vitest";

describe("generateApi", () => {
  it("rejects empty descriptions before any fetch", async () => {
    const { generateWorkflow } = await import("./generateApi");
    await expect(generateWorkflow({ description: "   " })).rejects.toThrow(
      /describe/i,
    );
  });
});

describe("deriveWorkflowName", () => {
  it("uses the first line, capped at 48 chars", async () => {
    const { deriveWorkflowName } = await import("./generateApi");
    expect(deriveWorkflowName("Nightly test sweep")).toBe(
      "Nightly test sweep",
    );
    expect(
      deriveWorkflowName(
        "A very long description that keeps going past forty-eight characters easily",
      ).length,
    ).toBeLessThanOrEqual(48);
    expect(deriveWorkflowName("First line\nSecond line")).toBe("First line");
    expect(deriveWorkflowName("   ")).toBe("Generated workflow");
  });
});
