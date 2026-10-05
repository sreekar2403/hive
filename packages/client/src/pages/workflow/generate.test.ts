import { describe, it, expect } from "vitest";

describe("generateApi", () => {
  it("rejects empty descriptions before any fetch", async () => {
    const { generateWorkflow } = await import("./generateApi");
    await expect(generateWorkflow({ description: "   " })).rejects.toThrow(
      /describe/i,
    );
  });
});
