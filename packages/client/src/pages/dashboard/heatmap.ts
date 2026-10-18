/**
 * Client-side heatmap math for the Dashboard activity grid.
 *
 * Pure functions only — the server sends sparse day counts; this turns them
 * into a GitHub-style week-column grid (7 rows = Sun…Sat) plus month labels.
 */

export interface ActivityDay {
  date: string;
  count: number;
}

export interface ActivityStats {
  periodDays: number;
  days: ActivityDay[];
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
    successRate: number | null;
    avgIterations: number;
    totalFilesChanged: number;
    byHarness: Array<{ harness: string; count: number }>;
  };
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** Fixed thresholds — same discrete steps the design doc pins. */
export function heatLevel(count: number): HeatLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export interface HeatmapCell {
  date: string;
  count: number;
  level: HeatLevel;
  /** False for leading/trailing days outside the requested window. */
  inPeriod: boolean;
}

export interface MonthLabel {
  /** 0-based week column index. */
  week: number;
  label: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dayKeyLocal(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDayLocal(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Builds week columns from Sunday. Leading cells before `firstDay` and
 * trailing cells after `today` are present but marked `inPeriod: false` so
 * the grid stays rectangular without pretending future days have data.
 */
export function buildHeatmapGrid(
  days: ActivityDay[],
  periodDays: number,
  now: number = Date.now(),
): { weeks: HeatmapCell[][]; monthLabels: MonthLabel[] } {
  const countByDate = new Map(days.map((d) => [d.date, d.count]));
  const today = startOfDayLocal(now);
  const firstDay = today - (periodDays - 1) * 86_400_000;

  // Align the first column to the Sunday of firstDay's week.
  const firstDow = new Date(firstDay).getDay();
  const gridStart = firstDay - firstDow * 86_400_000;

  // Last column covers the week containing today.
  const todayDow = new Date(today).getDay();
  const gridEnd = today + (6 - todayDow) * 86_400_000;

  const weeks: HeatmapCell[][] = [];
  const monthLabels: MonthLabel[] = [];
  let lastLabelMonth = -1;

  for (let colStart = gridStart; colStart <= gridEnd; colStart += 7 * 86_400_000) {
    const week: HeatmapCell[] = [];
    for (let i = 0; i < 7; i++) {
      const ts = colStart + i * 86_400_000;
      const date = dayKeyLocal(ts);
      const inPeriod = ts >= firstDay && ts <= today;
      const count = countByDate.get(date) ?? 0;
      week.push({ date, count, level: heatLevel(count), inPeriod });
    }
    weeks.push(week);

    // Label a column when its first in-period day starts a new month.
    const anchor = week.find((c) => c.inPeriod);
    if (anchor) {
      const month = Number(anchor.date.slice(5, 7)) - 1;
      if (month !== lastLabelMonth) {
        monthLabels.push({ week: weeks.length - 1, label: MONTHS[month] });
        lastLabelMonth = month;
      }
    }
  }

  return { weeks, monthLabels };
}
