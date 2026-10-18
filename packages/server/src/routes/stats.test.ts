import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  computeActivityStats,
  currentStreak,
  dayKey,
  longestStreak,
  startOfDay,
  type ActivityStats,
  type ActivityTaskRow,
} from "../activity";
import statsRoutes from "./stats";
import { getDb } from "../db/database";
import { ensureKanbanTable } from "../kanban";

const DAY = 86_400_000;

function row(partial: Partial<ActivityTaskRow> & { created_at: number }): ActivityTaskRow {
  return {
    status: "done",
    harness: "opencode",
    iterations: 1,
    files_changed: 0,
    ...partial,
  };
}

describe("activity aggregation", () => {
  const now = new Date("2026-06-15T12:00:00").getTime();

  it("buckets runs by local calendar day", () => {
    const d = new Date(now);
    d.setHours(1, 0, 0, 0);
    const early = d.getTime();
    d.setHours(23, 0, 0, 0);
    const late = d.getTime();

    const stats = computeActivityStats(
      [row({ created_at: early }), row({ created_at: late })],
      30,
      now,
    );

    expect(stats.totals.runs).toBe(2);
    expect(stats.totals.activeDays).toBe(1);
    expect(stats.days).toEqual([
      { date: dayKey(early), count: 2 },
    ]);
  });

  it("counts a current streak ending today, and yesterday if today is quiet", () => {
    const today = startOfDay(now);
    const yesterday = today - DAY;
    const dayBefore = today - 2 * DAY;

    expect(
      currentStreak(new Set([dayKey(today), dayKey(yesterday)]), now),
    ).toBe(2);
    expect(currentStreak(new Set([dayKey(yesterday)]), now)).toBe(1);
    expect(
      currentStreak(
        new Set([dayKey(yesterday), dayKey(dayBefore)]),
        now,
      ),
    ).toBe(2);
    expect(currentStreak(new Set([dayKey(dayBefore)]), now)).toBe(0);
    expect(currentStreak(new Set(), now)).toBe(0);
  });

  it("finds the longest consecutive run of active days", () => {
    const today = startOfDay(now);
    const set = new Set([
      dayKey(today),
      dayKey(today - DAY),
      dayKey(today - 2 * DAY),
      dayKey(today - 5 * DAY),
    ]);
    expect(longestStreak(set)).toBe(3);
    expect(longestStreak(new Set())).toBe(0);
  });

  it("null-safes success rate and averages effort metrics", () => {
    const stats = computeActivityStats(
      [
        row({ created_at: now, status: "done", iterations: 2, files_changed: 3, harness: "claude" }),
        row({ created_at: now, status: "failed", iterations: 4, files_changed: 1, harness: "claude" }),
        row({ created_at: now, status: "in_progress", iterations: 1, files_changed: 0, harness: null }),
      ],
      30,
      now,
    );

    expect(stats.growth.successRate).toBeCloseTo(0.5);
    expect(stats.growth.avgIterations).toBeCloseTo(7 / 3);
    expect(stats.growth.totalFilesChanged).toBe(4);
    expect(stats.growth.byHarness).toEqual([
      { harness: "claude", count: 2 },
      { harness: "unknown", count: 1 },
    ]);
  });

  it("reports a null success rate when nothing is terminal", () => {
    const stats = computeActivityStats(
      [row({ created_at: now, status: "in_progress" })],
      30,
      now,
    );
    expect(stats.growth.successRate).toBeNull();
  });
});

describe("GET /api/stats/activity", () => {
  let base = "";
  let server: ReturnType<express.Application["listen"]> | null = null;
  const PROJECT = "proj-stats";
  const OTHER = "proj-other";

  beforeAll(async () => {
    ensureKanbanTable();
    const db = getDb();
    db.prepare("DELETE FROM kanban_tasks").run();

    const insert = db.prepare(
      `INSERT INTO kanban_tasks
         (id, project_id, prompt, status, harness, iterations, files_changed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    const today = startOfDay(now);
    // Two runs today in PROJECT, one yesterday in OTHER, one old done/failed pair.
    insert.run("t1", PROJECT, "a", "done", "opencode", 2, 1, today + 3600_000, now);
    insert.run("t2", PROJECT, "b", "in_progress", "claude", 1, 0, today + 7200_000, now);
    insert.run("t3", OTHER, "c", "done", "opencode", 3, 2, today - DAY + 3600_000, now);
    insert.run("t4", PROJECT, "d", "failed", "codex", 5, 0, today - 10 * DAY, now);

    const app = express();
    app.use("/api/stats", statsRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server!.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/api/stats`;
  });

  afterAll(async () => {
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server!.close((err: unknown) => (err ? reject(err) : resolve()));
    });
  });

  it("aggregates across every project when projectId is omitted", async () => {
    const res = await fetch(`${base}/activity`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityStats;
    expect(body.totals.runs).toBe(4);
    expect(body.totals.activeDays).toBeGreaterThanOrEqual(2);
    // Today + yesterday both have runs → a 2-day streak across projects.
    expect(body.totals.currentStreak).toBe(2);
    expect(body.growth.done).toBe(2);
    expect(body.growth.failed).toBe(1);
  });

  it("filters to one project when projectId is given", async () => {
    const res = await fetch(`${base}/activity?projectId=${PROJECT}`);
    const body = (await res.json()) as ActivityStats;
    expect(body.totals.runs).toBe(3);
    expect(body.growth.byHarness.map((h) => h.harness)).toContain("codex");
  });

  it("clamps an absurd days parameter to the default window", async () => {
    const res = await fetch(`${base}/activity?days=99999`);
    const body = (await res.json()) as ActivityStats;
    expect(body.periodDays).toBe(365);
  });
});
