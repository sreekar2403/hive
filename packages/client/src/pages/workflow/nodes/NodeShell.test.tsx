import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { truncate } from "./NodeShell";

const here = dirname(fileURLToPath(import.meta.url));
const shellSrc = readFileSync(join(here, "NodeShell.tsx"), "utf8");

describe("node text containment", () => {
  it("clamps a 120-char unbroken path with an ellipsis", () => {
    const path = `C:\\${"a".repeat(118)}`;
    expect(truncate(path, 72).endsWith("…")).toBe(true);
    expect(truncate(path, 72).length).toBeLessThanOrEqual(72);
  });

  it("leaves short text untouched", () => {
    expect(truncate("Run the tests", 72)).toBe("Run the tests");
  });

  it("wraps unbroken strings anywhere inside the fixed-width card", () => {
    expect(shellSrc).toContain("overflow-wrap:anywhere");
    expect(shellSrc).toContain("line-clamp-3");
    expect(shellSrc).toContain("overflow-hidden");
  });
});
