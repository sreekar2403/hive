import { useMemo, useState } from "react";
import { KeyRound, Search, Trash2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button, EmptyState, Input } from "../../components/ui";
import { formatBytes, formatRelativeTime } from "./format";
import type { MemoryEntrySummary } from "./types";

export function KeysPane({
  sessionId,
  entries,
  loading,
  selectedKey,
  onSelect,
  onRequestClear,
  className,
}: {
  sessionId: string | null;
  entries: MemoryEntrySummary[];
  loading: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onRequestClear: () => void;
  className?: string;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.key.toLowerCase().includes(q));
  }, [entries, search]);

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="px-3 pt-3 pb-2.5 border-b border-line shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow truncate">
            {sessionId ? sessionId : "Keys"}
          </div>
          {sessionId && entries.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRequestClear}
              className="text-danger hover:bg-danger-soft h-6 px-1.5 -mr-1.5"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
          ) : (
            <span className="text-[11px] font-mono text-faint" data-numeric>
              {entries.length}
            </span>
          )}
        </div>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-faint"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keys…"
            aria-label="Search keys"
            className="h-8 pl-8 text-xs"
            disabled={!sessionId}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {!sessionId ? (
          <EmptyState
            icon={<KeyRound />}
            title="No session selected"
            description="Pick a session on the left to browse its keys."
            className="py-10 px-4"
          />
        ) : loading ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted">
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<KeyRound />}
            title="No entries in this session"
            description="This session's store is empty."
            className="py-10 px-4"
          />
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted">
            No matching keys
          </div>
        ) : (
          <ul className="p-1.5 space-y-0.5">
            {filtered.map((entry) => {
              const selected = entry.key === selectedKey;
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry.key)}
                    aria-current={selected}
                    className={cn(
                      "w-full text-left rounded-md px-2.5 py-2 border transition-colors",
                      selected
                        ? "bg-accent-soft border-accent-line"
                        : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    <div className="font-mono text-xs text-ink truncate">
                      {entry.key}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span data-numeric>{formatBytes(entry.size)}</span>
                      <span>{formatRelativeTime(entry.updatedAt)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
