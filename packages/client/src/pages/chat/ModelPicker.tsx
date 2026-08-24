import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Cpu,
  RefreshCw,
  Search,
  Wand2,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useModelCatalog, type ModelOption } from "../../state/useModelCatalog";

/**
 * One control for the whole question of "who runs this": automatic
 * routing, a harness with its own default model, or an exact
 * harness/provider/model from the live catalog.
 *
 * The list is long — 130-odd models on a machine with three harnesses
 * installed — so it opens with the search field focused and filters as
 * you type across harness, provider and model together.
 */

const AUTO = "";

interface Row {
  value: string;
  harness: string;
  provider: string;
  model: string;
  hint: string | null;
  kind: "auto" | "harness" | "model";
}

export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { catalog, loading, refresh } = useModelCatalog();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [
      {
        value: AUTO,
        harness: "Automatic",
        provider: "",
        model: "route by what the prompt asks for",
        hint: null,
        kind: "auto",
      },
    ];

    const harnesses = new Map<string, ModelOption[]>();
    for (const option of catalog.options) {
      const list = harnesses.get(option.harness) ?? [];
      list.push(option);
      harnesses.set(option.harness, list);
    }

    for (const source of catalog.sources) {
      if (source.kind !== "harness") continue;
      out.push({
        value: `harness:${source.id}`,
        harness: source.id,
        provider: "",
        model: "its own default model",
        hint: null,
        kind: "harness",
      });
      for (const option of harnesses.get(source.id) ?? []) {
        out.push({
          value: option.id,
          harness: option.harness,
          provider: option.provider,
          model: option.model,
          hint: option.contextLabel,
          kind: "model",
        });
      }
    }

    return out;
  }, [catalog]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    const terms = needle.split(/\s+/);
    return rows.filter((row) => {
      const haystack =
        `${row.harness} ${row.provider} ${row.model} ${row.hint ?? ""}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [rows, query]);

  const current = rows.find((r) => r.value === value) ?? rows[0];

  // Clicking anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    } else {
      // Reopening should start from a clean search, not the last one.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    // Typing re-ranks the list, so the highlight has to return to the top.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlight(0);
  }, [query]);

  const choose = (row: Row) => {
    onChange(row.value);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2 rounded-md border border-line",
          "text-[12px] text-ink bg-surface hover:border-line-strong transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed max-w-[22rem]",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current.kind === "auto" ? (
          <Wand2 className="size-3.5 text-accent shrink-0" />
        ) : (
          <Cpu className="size-3.5 text-accent shrink-0" />
        )}
        <span className="truncate">
          {current.kind === "model" ? (
            <>
              <span className="text-muted">{current.harness}</span>
              <span className="text-faint"> / </span>
              <span className="text-muted">{current.provider}</span>
              <span className="text-faint"> / </span>
              {current.model}
            </>
          ) : current.kind === "harness" ? (
            <>
              {current.harness}
              <span className="text-faint"> · default model</span>
            </>
          ) : (
            "Choose automatically"
          )}
        </span>
        <ChevronDown className="size-3.5 text-faint shrink-0" />
      </button>

      {open ? (
        <div
          className={cn(
            "absolute bottom-full left-0 mb-1 z-50 w-[26rem]",
            "bg-surface border border-line rounded-lg shadow-card overflow-hidden",
          )}
        >
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-line">
            <Search className="size-3.5 text-faint shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, filtered.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                }
                if (e.key === "Enter" && filtered[highlight]) {
                  e.preventDefault();
                  choose(filtered[highlight]);
                }
              }}
              placeholder="Search harness, provider or model…"
              className="flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
              aria-label="Search models"
            />
            <button
              onClick={() => void refresh(true)}
              className="text-faint hover:text-ink transition-colors"
              aria-label="Rediscover models"
              title="Ask every harness and local server again"
            >
              <RefreshCw
                className={cn("size-3.5", loading && "animate-spin")}
              />
            </button>
          </div>

          <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-[12px] text-muted">
                {loading ? "Discovering models…" : "Nothing matches that."}
              </li>
            ) : null}

            {filtered.map((row, i) => (
              <li key={row.value || "auto"}>
                <button
                  onClick={() => choose(row)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px]",
                    i === highlight ? "bg-surface-2" : "",
                    row.kind !== "model" && "border-b border-line/40",
                  )}
                  role="option"
                  aria-selected={row.value === value}
                >
                  <Check
                    className={cn(
                      "size-3 shrink-0",
                      row.value === value ? "text-accent" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {row.kind === "model" ? (
                      <>
                        <span className="text-faint">{row.harness} / </span>
                        <span className="text-muted">{row.provider} / </span>
                        <span className="text-ink">{row.model}</span>
                      </>
                    ) : (
                      <span className="text-ink">
                        {row.kind === "auto"
                          ? "Choose automatically"
                          : row.harness}
                        <span className="text-faint"> · {row.model}</span>
                      </span>
                    )}
                  </span>
                  {row.hint ? (
                    <span className="text-[10px] text-faint shrink-0 font-mono">
                      {row.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          <div className="px-3 py-1.5 border-t border-line text-[10px] text-faint">
            {catalog.options.length} models ·{" "}
            {catalog.sources
              .filter((s) => !s.ok)
              .map((s) => `${s.label} unavailable`)
              .join(" · ") || "all sources answered"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
