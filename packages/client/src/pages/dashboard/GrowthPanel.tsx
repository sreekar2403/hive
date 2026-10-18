import type { ActivityStats } from "./heatmap";

function pct(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

/**
 * Growth tab: terminal outcomes, effort and harness split for the period.
 */
export function GrowthPanel({ stats }: { stats: ActivityStats }) {
  const { growth } = stats;
  const maxHarness = growth.byHarness.reduce((m, h) => Math.max(m, h.count), 0);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric
          label="Success rate"
          value={pct(growth.successRate)}
          hint={`${growth.done} done · ${growth.failed} failed`}
        />
        <Metric
          label="Avg iterations"
          value={growth.avgIterations.toFixed(1)}
          hint="per run in this period"
        />
        <Metric
          label="Files changed"
          value={growth.totalFilesChanged}
          hint="summed across runs"
        />
      </div>

      {growth.byHarness.length === 0 ? (
        <p className="text-[13px] text-muted">
          No runs in this period yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="eyebrow">By harness</div>
          {growth.byHarness.map((h) => (
            <div key={h.harness} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-[12px] font-mono text-ink truncate">
                {h.harness}
              </span>
              <div className="flex-1 h-2 rounded-sm bg-surface-2 overflow-hidden">
                <div
                  className="h-full bg-accent rounded-sm"
                  style={{
                    width: `${maxHarness ? (h.count / maxHarness) * 100 : 0}%`,
                  }}
                />
              </div>
              <span
                className="w-10 text-right text-[12px] text-muted"
                data-numeric
              >
                {h.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="text-[22px] leading-none font-semibold text-ink" data-numeric>
        {value}
      </div>
      <div className="text-[11px] text-muted mt-1">{hint}</div>
    </div>
  );
}
