import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Info,
  MessagesSquare,
  Pause,
  Play,
  Search,
  Trash2,
  Waypoints,
} from "lucide-react";
import {
  Badge,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  SegmentedControl,
  Select,
  StatusDot,
} from "../components/ui";
import {
  useLogs,
  type LogLevel,
  type LogsMode,
  type SpanRow,
  type TraceSummary,
} from "../state/LogsContext";
import { cn } from "../lib/cn";

const LEVEL_TONE: Record<LogLevel, "neutral" | "info" | "warn" | "danger"> = {
  debug: "neutral",
  info: "info",
  warn: "warn",
  error: "danger",
};

const LEVEL_ICON: Record<LogLevel, typeof Info> = {
  debug: Info,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const SPAN_TONE: Record<string, string> = {
  task: "bg-accent",
  route: "bg-info",
  permission: "bg-warn",
  iteration: "bg-accent",
  harness: "bg-ok",
  tool: "bg-info",
  git: "bg-info",
  result: "bg-ok",
};

/**
 * Scroll offsets and collapsed spans are per-visit UI state: worth keeping
 * while the app is open so tabbing away and back doesn't lose your place,
 * not worth persisting to storage.
 */
let streamScrollTop = 0;
const collapsedByTask = new Map<string, Set<string>>();

export function LogsPage() {
  const { mode, setMode } = useLogs();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Inspect"
          title="Logs"
          description="Everything the swarm did, as a stream or as the shape of one run."
          actions={
            <SegmentedControl<LogsMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "stream", label: "Stream" },
                { value: "traces", label: "Traces" },
              ]}
            />
          }
        />
      </div>
      <div className="flex-1 min-h-0 border-t border-line">
        {mode === "stream" ? <LogStream /> : <TraceExplorer />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stream                                                              */
/* ------------------------------------------------------------------ */

function LogStream() {
  const {
    filtered,
    logs,
    sources,
    loading,
    filters,
    setFilters,
    paused,
    setPaused,
    clear,
    expandedLogId,
    setExpandedLogId,
  } = useLogs();

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Come back to the tail where you left it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = streamScrollTop;
    stickRef.current = streamScrollTop < 20;
  }, []);

  // Auto-scroll only while the reader is already at the top of the tail.
  useEffect(() => {
    if (stickRef.current) scrollRef.current?.scrollTo({ top: 0 });
  }, [filtered]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-line">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-faint" />
          <Input
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value })}
            placeholder="Search messages…"
            className="h-8 pl-8 w-56 text-[12px]"
            aria-label="Search logs"
          />
        </div>
        <Select
          value={filters.level}
          onChange={(e) => setFilters({ level: e.target.value as LogLevel | "" })}
          className="h-8 w-28 text-[12px]"
          aria-label="Filter by level"
        >
          <option value="">All levels</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </Select>
        <Select
          value={filters.source}
          onChange={(e) => setFilters({ source: e.target.value })}
          className="h-8 w-36 text-[12px]"
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-faint ml-auto" data-numeric>
          {filtered.length}
          {filtered.length === logs.length ? "" : ` of ${logs.length}`} lines
        </span>
        {paused ? (
          <Badge tone="warn">Paused</Badge>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <StatusDot tone="ok" pulse />
            live
          </span>
        )}
        <IconButton
          size="sm"
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "Resume live tail" : "Pause live tail"}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </IconButton>
        <IconButton size="sm" onClick={clear} aria-label="Clear the view">
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          streamScrollTop = e.currentTarget.scrollTop;
          stickRef.current = e.currentTarget.scrollTop < 20;
        }}
        className="flex-1 overflow-y-auto"
      >
        {loading ? (
          <p className="px-6 py-4 text-[13px] text-muted">Loading logs…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title={logs.length === 0 ? "No logs yet" : "Nothing matches"}
            description={
              logs.length === 0
                ? "Logs appear as soon as the swarm runs a task. Start one from Chat."
                : "No lines match the current filters. Clear them to see the whole tail."
            }
          />
        ) : (
          <table className="w-full font-mono text-[12px]">
            <tbody>
              {filtered.map((l) => {
                const Icon = LEVEL_ICON[l.level];
                const open = expandedLogId === l.id;
                return (
                  <tr
                    key={l.id}
                    className="border-b border-line/60 align-top hover:bg-surface-2/50"
                  >
                    <td
                      className="w-40 px-3 py-1.5 text-faint whitespace-nowrap"
                      data-numeric
                    >
                      {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
                      <span className="opacity-60">
                        .{String(l.ts % 1000).padStart(3, "0")}
                      </span>
                    </td>
                    <td className="w-20 px-1 py-1.5">
                      <Badge tone={LEVEL_TONE[l.level]}>
                        <Icon className="size-2.5" />
                        {l.level}
                      </Badge>
                    </td>
                    <td className="w-28 px-2 py-1.5 text-muted truncate">
                      {l.source}
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => setExpandedLogId(open ? null : l.id)}
                        className="text-left w-full text-ink hover:text-accent transition-colors"
                        disabled={!l.context}
                      >
                        {l.message}
                      </button>
                      {open && l.context ? (
                        <pre className="mt-1.5 p-2 rounded-md bg-surface-2 border border-line text-[11px] text-muted whitespace-pre-wrap break-all">
                          {prettyJson(l.context)}
                        </pre>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Traces                                                              */
/* ------------------------------------------------------------------ */

/*
 * Runs from the same chat are shown together. A trace still covers one
 * message — that is what a run is — but a conversation is the unit a person
 * was actually following, so the messages of one chat no longer scatter
 * through the list as unrelated entries.
 */
function groupTraces(traces: TraceSummary[]) {
  const groups: Array<{
    key: string;
    sessionId: string | null;
    label: string;
    traces: TraceSummary[];
  }> = [];
  for (const trace of traces) {
    const key = trace.sessionId ?? `solo:${trace.taskId}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.traces.push(trace);
      continue;
    }
    groups.push({
      key,
      sessionId: trace.sessionId,
      // The conversation is named after its oldest run, which is the last
      // one in this newest-first list.
      label: trace.name,
      traces: [trace],
    });
  }
  for (const group of groups) {
    group.label = group.traces[group.traces.length - 1].name;
  }
  return groups;
}

function TraceExplorer() {
  const { traces, tracesLoading, selectedTaskId, selectTrace, spans } = useLogs();
  const groups = useMemo(() => groupTraces(traces), [traces]);

  if (tracesLoading && traces.length === 0) {
    return <p className="px-6 py-4 text-[13px] text-muted">Loading traces…</p>;
  }

  if (traces.length === 0) {
    return (
      <EmptyState
        icon={<Waypoints />}
        title="No traces yet"
        description="Every task run is recorded as a trace showing routing, each retry, and every tool it used. Start a task from Chat."
      />
    );
  }

  return (
    <div className="h-full flex">
      <div className="w-80 shrink-0 border-r border-line overflow-y-auto">
        {groups.map((group) => (
          <div key={group.key}>
            {group.sessionId ? (
              <div className="px-3 pt-3 pb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-faint">
                <MessagesSquare className="size-3" />
                <span className="truncate">{group.label}</span>
                <span className="ml-auto font-mono" data-numeric>
                  {group.traces.length}
                </span>
              </div>
            ) : null}
            {group.traces.map((t) => (
          <button
            key={t.taskId}
            onClick={() => selectTrace(t.taskId)}
            className={cn(
              "w-full text-left px-3 py-2.5 border-l-2 border-b border-b-line transition-colors",
              selectedTaskId === t.taskId
                ? "bg-accent-soft border-l-accent"
                : "border-l-transparent hover:bg-surface-2",
            )}
          >
            <div className="flex items-center gap-2">
              <StatusDot
                tone={
                  t.status === "ok"
                    ? "ok"
                    : t.status === "failed"
                      ? "danger"
                      : "accent"
                }
                pulse={t.status === "running"}
              />
              <span className="text-[13px] text-ink truncate flex-1">{t.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 font-mono text-[10px] text-faint">
              <span data-numeric>{formatMs(t.durationMs)}</span>
              <span data-numeric>{t.spanCount} spans</span>
              <span className="ml-auto">
                {new Date(t.startedAt).toLocaleTimeString([], { hour12: false })}
              </span>
            </div>
          </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex-1 min-w-0 overflow-auto">
        <SpanWaterfall spans={spans} taskId={selectedTaskId} />
      </div>
    </div>
  );
}

function SpanWaterfall({
  spans,
  taskId,
}: {
  spans: SpanRow[];
  taskId: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(taskId ? (collapsedByTask.get(taskId) ?? []) : []),
  );

  // Collapsed rows follow the run they belong to.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(new Set(taskId ? (collapsedByTask.get(taskId) ?? []) : []));
  }, [taskId]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (taskId) collapsedByTask.set(taskId, next);
      return next;
    });

  const { roots, byParent, t0, total } = useMemo(() => {
    const byParent = new Map<string | null, SpanRow[]>();
    for (const s of spans) {
      const list = byParent.get(s.parentId) ?? [];
      list.push(s);
      byParent.set(s.parentId, list);
    }
    const t0 = spans.length ? Math.min(...spans.map((s) => s.startedAt)) : 0;
    const end = spans.length
      ? Math.max(...spans.map((s) => s.endedAt ?? s.startedAt))
      : 0;
    return {
      roots: byParent.get(null) ?? [],
      byParent,
      t0,
      total: Math.max(1, end - t0),
    };
  }, [spans]);

  if (spans.length === 0) {
    return (
      <p className="px-6 py-4 text-[13px] text-muted">
        Select a run to see its trace.
      </p>
    );
  }

  const rows: Array<{ span: SpanRow; depth: number }> = [];
  const walk = (list: SpanRow[], depth: number) => {
    for (const s of list) {
      rows.push({ span: s, depth });
      const kids = byParent.get(s.id);
      if (kids && !open.has(`collapsed:${s.id}`)) walk(kids, depth + 1);
    }
  };
  walk(roots, 0);

  // Duration by span type, so it's obvious where the time actually went.
  const breakdown = new Map<string, number>();
  for (const s of spans) {
    if (s.parentId === null) continue;
    const d = (s.endedAt ?? s.startedAt) - s.startedAt;
    breakdown.set(s.type, (breakdown.get(s.type) ?? 0) + d);
  }

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-surface border-b border-line">
        <span className="eyebrow">Total</span>
        <span className="font-mono text-[12px] text-ink" data-numeric>
          {formatMs(total)}
        </span>
        <div className="flex items-center gap-2 ml-4">
          {[...breakdown.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([type, ms]) => (
              <span
                key={type}
                className="flex items-center gap-1 text-[11px] text-muted"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    SPAN_TONE[type] ?? "bg-faint",
                  )}
                />
                {type} <span data-numeric>{formatMs(ms)}</span>
              </span>
            ))}
        </div>
      </div>

      <ul>
        {rows.map(({ span, depth }) => {
          const dur = (span.endedAt ?? span.startedAt) - span.startedAt;
          const offset = ((span.startedAt - t0) / total) * 100;
          const width = Math.max(0.6, (dur / total) * 100);
          const hasKids = (byParent.get(span.id)?.length ?? 0) > 0;
          const collapsed = open.has(`collapsed:${span.id}`);
          const detailOpen = open.has(`detail:${span.id}`);

          return (
            <li key={span.id} className="border-b border-line/60">
              <div
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2/50"
                style={{ paddingLeft: 12 + depth * 16 }}
              >
                <button
                  onClick={() => toggle(`collapsed:${span.id}`)}
                  className={cn("text-faint hover:text-ink", !hasKids && "invisible")}
                  aria-label={collapsed ? "Expand" : "Collapse"}
                >
                  {collapsed ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </button>

                <button
                  onClick={() => toggle(`detail:${span.id}`)}
                  className="text-[12px] text-ink truncate w-64 shrink-0 text-left hover:text-accent"
                  disabled={!span.detail}
                >
                  {span.name}
                </button>

                <Badge tone={span.outcome === "failed" ? "danger" : "neutral"}>
                  {span.type}
                </Badge>

                {/* Proportional duration bar */}
                <div className="flex-1 min-w-24 h-3 relative bg-surface-2 rounded-sm">
                  <div
                    className={cn(
                      "absolute h-full rounded-sm",
                      span.outcome === "failed"
                        ? "bg-danger"
                        : (SPAN_TONE[span.type] ?? "bg-faint"),
                    )}
                    style={{ left: `${offset}%`, width: `${width}%` }}
                  />
                </div>

                <span
                  className="font-mono text-[11px] text-muted w-16 text-right shrink-0"
                  data-numeric
                >
                  {formatMs(dur)}
                </span>
              </div>

              {detailOpen && span.detail ? (
                <pre
                  className="mx-3 mb-2 p-2 rounded-md bg-surface-2 border border-line font-mono text-[11px] text-muted whitespace-pre-wrap break-all"
                  style={{ marginLeft: 12 + depth * 16 }}
                >
                  {prettyJson(span.detail)}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
