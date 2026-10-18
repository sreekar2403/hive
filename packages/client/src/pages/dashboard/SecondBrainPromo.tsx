import { Link } from "react-router-dom";
import { Button, Card, CardHeader } from "../../components/ui";

/**
 * Dashboard footer promo for Second Brain — Hive's real "learns how you
 * work" feature. Off: CTA into Settings. On: link into Memory.
 */
export function SecondBrainPromo({
  enabled,
}: {
  /** null while settings are still loading. */
  enabled: boolean | null;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardHeader
        eyebrow="Second Brain"
        title="Hive can learn how you work"
      />
      <div className="relative p-4">
        <div className="relative z-10 max-w-[46ch]">
          <p className="text-[13px] text-muted leading-relaxed">
            Once enabled, Hive keeps notes on your preferences, habits and
            corrections — so every run starts from what the last one taught
            it, not from scratch.
          </p>
          <div className="mt-4">
            {enabled === null ? (
              <span className="text-[12px] text-muted">Checking settings…</span>
            ) : enabled ? (
              <Link to="/memory">
                <Button variant="default" size="sm">
                  View memory
                </Button>
              </Link>
            ) : (
              <Link to="/settings">
                <Button variant="primary" size="sm">
                  Enable Second Brain
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Decorative faded grid — echoes the reference promo without animation. */}
        <div
          className="pointer-events-none absolute right-4 top-4 hidden sm:grid grid-cols-8 gap-2 opacity-60"
          aria-hidden="true"
        >
          {Array.from({ length: 32 }, (_, i) => (
            <span
              key={i}
              className={
                i === 18 || i === 19 || i === 26
                  ? "size-3.5 rounded-full bg-accent/50"
                  : "size-3.5 rounded-full bg-line"
              }
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
