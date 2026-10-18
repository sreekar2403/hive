import { describe, it, expect } from "vitest";
import { formatElapsed, statusTone } from "./RunPanel";

describe("run panel helpers", () => {
  it("formats elapsed clocks, not timestamps", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(180_000)).toBe("3m");
    expect(formatElapsed(3_600_000 + 12 * 60_000)).toBe("1h12m");
  });

  it("maps every run/step status to a tone", () => {
    expect(statusTone("success")).toBe("ok");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("cancelled")).toBe("danger");
    expect(statusTone("running")).toBe("accent");
    expect(statusTone("waiting_approval")).toBe("accent");
    expect(statusTone("pending")).toBe("neutral");
    expect(statusTone("skipped")).toBe("neutral");
    expect(statusTone("queued")).toBe("neutral");
    expect(statusTone("anything-else")).toBe("neutral");
  });
});
