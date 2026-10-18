import { describe, expect, it } from "vitest";
import { buildHeatmapGrid, heatLevel } from "./heatmap";

describe("heatLevel", () => {
  it("maps counts to four discrete steps", () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(2)).toBe(2);
    expect(heatLevel(3)).toBe(2);
    expect(heatLevel(4)).toBe(3);
    expect(heatLevel(6)).toBe(3);
    expect(heatLevel(7)).toBe(4);
    expect(heatLevel(99)).toBe(4);
  });
});

describe("buildHeatmapGrid", () => {
  // Pick a fixed "today" so the grid is deterministic.
  const now = new Date("2026-06-15T12:00:00").getTime(); // a Monday

  it("builds week columns with 7 day cells each", () => {
    const { weeks } = buildHeatmapGrid([], 28, now);
    // 28 days + leading Sunday pad + trailing Saturday pad → at least 5 weeks.
    expect(weeks.length).toBeGreaterThanOrEqual(5);
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it("marks only in-period days as active cells", () => {
    const { weeks } = buildHeatmapGrid([], 14, now);
    const inPeriod = weeks.flat().filter((c) => c.inPeriod);
    expect(inPeriod).toHaveLength(14);
    // Today is the last in-period cell.
    const last = inPeriod[inPeriod.length - 1];
    expect(new Date(last.date + "T00:00:00").getTime()).toBe(
      new Date(now).setHours(0, 0, 0, 0),
    );
  });

  it("applies intensity from sparse day counts", () => {
    const todayKey = (() => {
      const d = new Date(now);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const { weeks } = buildHeatmapGrid(
      [{ date: todayKey, count: 5 }],
      14,
      now,
    );
    const cell = weeks
      .flat()
      .find((c) => c.date === todayKey && c.inPeriod);
    expect(cell?.count).toBe(5);
    expect(cell?.level).toBe(3);
  });

  it("labels each month that appears in the period", () => {
    // 400 days ending mid-June 2026 spans several months.
    const { monthLabels } = buildHeatmapGrid([], 400, now);
    const labels = monthLabels.map((m) => m.label);
    expect(labels).toContain("Jun");
    expect(labels.length).toBeGreaterThanOrEqual(6);
  });
});
