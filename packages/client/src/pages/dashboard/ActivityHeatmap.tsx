import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import {
  buildHeatmapGrid,
  type ActivityDay,
  type HeatLevel,
} from "./heatmap";

const LEVEL_CLASSES: Record<HeatLevel, string> = {
  0: "bg-line/70",
  1: "bg-accent/25",
  2: "bg-accent/45",
  3: "bg-accent/70",
  4: "bg-accent",
};

/**
 * GitHub-style contribution grid: 7 rows (Sun…Sat), one column per week.
 * Pure presentational — pass sparse day counts and the period length.
 */
export function ActivityHeatmap({
  days,
  periodDays,
  now,
}: {
  days: ActivityDay[];
  periodDays: number;
  /** Fixed once per mount so the grid does not re-bucket on every render. */
  now?: number;
}) {
  const [mountedAt] = useState(() => Date.now());
  const effectiveNow = now ?? mountedAt;

  const { weeks, monthLabels } = useMemo(
    () => buildHeatmapGrid(days, periodDays, effectiveNow),
    [days, periodDays, effectiveNow],
  );

  const max = days.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <div className="px-4 py-4">
      <div
        className="grid gap-[3px] w-max max-w-full overflow-x-auto"
        style={{
          gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
          gridTemplateRows: "repeat(7, 12px)",
          gridAutoFlow: "column",
        }}
        role="img"
        aria-label={`Agent activity over the last ${periodDays} days, ${max} runs on the busiest day`}
      >
        {weeks.map((week, wi) =>
          week.map((cell, di) => (
            <div
              key={`${wi}-${di}`}
              title={
                cell.inPeriod
                  ? `${cell.date}: ${cell.count} run${cell.count === 1 ? "" : "s"}`
                  : undefined
              }
              className={cn(
                "rounded-[3px] w-3 h-3",
                cell.inPeriod
                  ? LEVEL_CLASSES[cell.level]
                  : "bg-transparent",
              )}
            />
          )),
        )}
      </div>

      {/* Month labels sit in a second grid aligned to the same columns. */}
      <div
        className="relative mt-1.5 h-4 w-max max-w-full overflow-hidden"
        style={{
          width: weeks.length * 15 - 3,
        }}
        aria-hidden="true"
      >
        {monthLabels.map((m) => (
          <span
            key={`${m.week}-${m.label}`}
            className="absolute text-[11px] text-muted leading-none"
            style={{ left: m.week * 15 }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as HeatLevel[]).map((level) => (
          <span
            key={level}
            className={cn("rounded-[3px] size-2.5", LEVEL_CLASSES[level])}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
