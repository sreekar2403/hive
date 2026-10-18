import { Check } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  THEME_META,
  getPalette,
  themeGroups,
  useTheme,
  type ThemeId,
  type ThemeMode,
} from "../../themes";

const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function AppearanceSection() {
  const { theme, mode, resolvedMode, setTheme, setMode } = useTheme();

  return (
    <section aria-label="Appearance" className="p-4">
      <div className="eyebrow">Appearance</div>
      <div className="text-sm font-semibold text-ink mt-0.5 mb-3">Theme</div>

      <div
        role="radiogroup"
        aria-label="Light, dark, or system"
        className="inline-flex rounded-md border border-line bg-surface-2 p-0.5 mb-1"
      >
        {MODE_OPTIONS.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            onClick={() => setMode(m.value)}
            className={cn(
              "px-3 h-7 rounded text-[12px] font-medium transition-colors",
              mode === m.value
                ? "bg-surface text-ink shadow-card"
                : "text-muted hover:text-ink",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted mb-4 h-4">
        {mode === "system" ? `System — currently ${resolvedMode}.` : ""}
      </p>

      {themeGroups().map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          <div className="text-[12px] font-medium text-ink mb-2">
            {group.label}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {group.ids.map((id) => (
              <ThemeCard
                key={id}
                id={id}
                resolvedMode={resolvedMode}
                selected={id === theme}
                onPick={setTheme}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ThemeCard({
  id,
  resolvedMode,
  selected,
  onPick,
}: {
  id: ThemeId;
  resolvedMode: "light" | "dark";
  selected: boolean;
  onPick: (id: ThemeId) => void;
}) {
  const p = getPalette(id, resolvedMode);
  const meta = THEME_META[id];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onPick(id)}
      className={cn(
        "text-left rounded-lg border p-2.5 transition-colors",
        selected
          ? "border-accent ring-1 ring-accent"
          : "border-line hover:border-accent-line",
      )}
    >
      <div
        className="flex h-6 rounded overflow-hidden border border-line mb-2"
        aria-hidden="true"
      >
        <span className="flex-1" style={{ background: p.bg }} />
        <span className="flex-1" style={{ background: p.surface }} />
        <span className="flex-1" style={{ background: p.accent }} />
      </div>
      <div className="text-[12px] font-medium text-ink flex items-center justify-between gap-1">
        <span className="truncate">{meta.name}</span>
        {selected ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
      </div>
      <div className="text-[10px] text-muted truncate">{meta.tag}</div>
    </button>
  );
}
