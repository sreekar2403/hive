import { useMemo, useState } from "react";
import { Database, Search } from "lucide-react";
import { cn } from "../../lib/cn";
import { EmptyState, Input } from "../../components/ui";
import { formatBytes, formatRelativeTime } from "./format";
import type { MemorySessionSummary } from "./types";

export function SessionsPane({
  sessions,
  loading,
  selectedSessionId,
  onSelect,
  className,
}: {
  sessions: MemorySessionSummary[];
  loading: boolean;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  className?: string;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.sessionId.toLowerCase().includes(q));
  }, [sessions, search]);

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="px-3 pt-3 pb-2.5 border-b border-line shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow">Sessions</div>
          <span className="text-[11px] font-mono text-faint" data-numeric>
            {sessions.length}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-faint" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted">Loading…</div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<Database />}
            title="No sessions yet"
            description="Memory fills up as the swarm runs tasks — each session gets its own key/value store on disk."
            className="py-10 px-4"
          />
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted">No matching sessions</div>
        ) : (
          <ul className="p-1.5 space-y-0.5">
            {filtered.map((session) => {
              const selected = session.sessionId === selectedSessionId;
              return (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    onClick={() => onSelect(session.sessionId)}
                    aria-current={selected}
                    className={cn(
                      "w-full text-left rounded-md px-2.5 py-2 border transition-colors",
                      selected
                        ? "bg-accent-soft border-accent-line"
                        : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    <div className="font-mono text-xs text-ink truncate">{session.sessionId}</div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span data-numeric>
                        {session.entryCount} {session.entryCount === 1 ? "key" : "keys"} ·{" "}
                        {formatBytes(session.totalSize)}
                      </span>
                      <span>{formatRelativeTime(session.lastModified)}</span>
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
