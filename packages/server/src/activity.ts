/**
 * Daily agent-run aggregation for the dashboard's observability heatmap.
 *
 * Pure helpers + one SQLite query. Kept out of the route so streak math and
 * success-rate null-safety can be unit-tested without spinning up Express.
 * Source of truth is kanban_tasks — every run that reaches the board writes
 * a row there with created_at, status, iterations and files_changed.
 */

export interface ActivityTaskRow {
  status: string;
  harness: string | null;
  iterations: number;
  files_changed: number;
  created_at: number;
}

export interface ActivityDayCount {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  count: number;
}

export interface ActivityStats {
  periodDays: number;
  /** Sparse — only days with count > 0. The client fills empty cells. */
  days: ActivityDayCount[];
  totals: {
    runs: number;
    activeDays: number;
    currentStreak: number;
    longestStreak: number;
    firstRunAt: number | null;
  };
  growth: {
    done: number;
    failed: number;
    /** done / (done + failed); null when nothing has reached a terminal state. */
    successRate: number | null;
    avgIterations: number;
    totalFilesChanged: number;
    byHarness: Array<{ harness: string; count: number }>;
  };
}

/** Local-time day key so the heatmap matches the user's calendar, not UTC. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Midnight local time for the calendar day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Consecutive active days ending at `today` (or yesterday if today is quiet).
 * Standard contribution-graph semantics: a gap yesterday with activity today
 * still reads as a 1-day streak, not 0.
 */
export function currentStreak(activeDays: Set<string>, now: number): number {
  const DAY = 86_400_000;
  let cursor = startOfDay(now);
  if (!activeDays.has(dayKey(cursor))) {
    cursor -= DAY;
    if (!activeDays.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (activeDays.has(dayKey(cursor))) {
    streak += 1;
    cursor -= DAY;
  }
  return streak;
}

/** Longest run of consecutive active days, in either direction. */
export function longestStreak(activeDays: Set<string>): number {
  if (activeDays.size === 0) return 0;
  const sorted = [...activeDays].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00`).getTime();
    const cur = new Date(`${sorted[i]}T00:00:00`).getTime();
    // Day delta of exactly 1 continues the run; anything larger breaks it.
    if (cur - prev === 86_400_000) run += 1;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

export function computeActivityStats(
  rows: ActivityTaskRow[],
  periodDays: number,
  now: number = Date.now(),
): ActivityStats {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(row.created_at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const activeDays = new Set(counts.keys());
  const days: ActivityDayCount[] = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  let done = 0;
  let failed = 0;
  let iterationsSum = 0;
  let filesSum = 0;
  const byHarness = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "done") done += 1;
    if (row.status === "failed") failed += 1;
    iterationsSum += row.iterations;
    filesSum += row.files_changed;
    const h = row.harness ?? "unknown";
    byHarness.set(h, (byHarness.get(h) ?? 0) + 1);
  }

  const terminal = done + failed;
  const n = rows.length;

  return {
    periodDays,
    days,
    totals: {
      runs: n,
      activeDays: activeDays.size,
      currentStreak: currentStreak(activeDays, now),
      longestStreak: longestStreak(activeDays),
      firstRunAt: n > 0 ? Math.min(...rows.map((r) => r.created_at)) : null,
    },
    growth: {
      done,
      failed,
      successRate: terminal > 0 ? done / terminal : null,
      avgIterations: n > 0 ? iterationsSum / n : 0,
      totalFilesChanged: filesSum,
      byHarness: [...byHarness.entries()]
        .map(([harness, count]) => ({ harness, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}
