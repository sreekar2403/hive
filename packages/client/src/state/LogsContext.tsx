import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { API, subscribeToEvents } from "../lib/api";
import { useProjects } from "./ProjectContext";

/**
 * The log tail and trace list live above the router for the same reason
 * chat does: a screen you are not currently looking at still has things
 * happening on it.
 *
 * Previously the tail only existed while the Logs page was mounted, so
 * running a task from Chat and then opening Logs showed nothing that had
 * happened in between (and every mount opened another EventSource). Here
 * the buffer fills from the moment the app starts, and the page is just a
 * view onto it.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogsMode = "stream" | "traces";

export interface LogRow {
  id: string;
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
  taskId: string | null;
  projectId: string | null;
  context: string | null;
}

export interface TraceSummary {
  taskId: string;
  /** The chat conversation this run belongs to, when it came from one. */
  sessionId: string | null;
  name: string;
  startedAt: number;
  durationMs: number;
  spanCount: number;
  status: "ok" | "failed" | "running";
}

export interface SpanRow {
  id: string;
  taskId: string;
  parentId: string | null;
  name: string;
  type: string;
  startedAt: number;
  endedAt: number | null;
  outcome: "ok" | "failed" | "skipped" | null;
  detail: string | null;
}

export interface LogFilters {
  level: LogLevel | "";
  source: string;
  q: string;
}

interface LogsContextValue {
  /** Everything received or fetched, newest first, project-scoped. */
  logs: LogRow[];
  /** `logs` narrowed by the current filters. */
  filtered: LogRow[];
  sources: string[];
  loading: boolean;
  filters: LogFilters;
  setFilters: (patch: Partial<LogFilters>) => void;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
  refresh: () => Promise<void>;

  mode: LogsMode;
  setMode: (mode: LogsMode) => void;
  expandedLogId: string | null;
  setExpandedLogId: (id: string | null) => void;

  traces: TraceSummary[];
  tracesLoading: boolean;
  selectedTaskId: string | null;
  selectTrace: (taskId: string | null) => void;
  spans: SpanRow[];
  spansLoading: boolean;
  /** Switches to the Traces tab and selects one run; used from Chat. */
  focusTrace: (taskId: string) => void;
}

const LogsContext = createContext<LogsContextValue | null>(null);

/** Keeps a long-running session from growing without bound. */
const MAX_BUFFER = 1500;
const VIEW_KEY = "hive.logs.view";

interface PersistedView {
  mode: LogsMode;
  filters: LogFilters;
  paused: boolean;
}

const DEFAULT_VIEW: PersistedView = {
  mode: "stream",
  filters: { level: "", source: "", q: "" },
  paused: false,
};

/** Read once per page load; every provider instance sees the same view. */
let cachedView: PersistedView | null = null;

function initialView(): PersistedView {
  if (!cachedView) cachedView = loadView();
  return cachedView;
}

function loadView(): PersistedView {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<PersistedView>;
    return {
      mode: parsed.mode === "traces" ? "traces" : "stream",
      filters: { ...DEFAULT_VIEW.filters, ...(parsed.filters ?? {}) },
      paused: Boolean(parsed.paused),
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function LogsProvider({ children }: { children: ReactNode }) {
  const { activeProjectId } = useProjects();

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [serverSources, setServerSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<LogFilters>(
    () => initialView().filters,
  );
  const [paused, setPaused] = useState(() => initialView().paused);
  const [mode, setMode] = useState<LogsMode>(() => initialView().mode);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [tracesLoading, setTracesLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [spans, setSpans] = useState<SpanRow[]>([]);
  const [spansLoading, setSpansLoading] = useState(false);

  // Mirrored into refs so the long-lived stream subscription below can
  // read the current values without being torn down and re-established
  // every time a filter or the active project changes.
  const pausedRef = useRef(paused);
  const projectRef = useRef(activeProjectId);
  useEffect(() => {
    pausedRef.current = paused;
    projectRef.current = activeProjectId;
  }, [paused, activeProjectId]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ mode, filters, paused }));
    } catch {
      /* storage unavailable */
    }
  }, [mode, filters, paused]);

  /* ----------------------------- stream ---------------------------- */

  // Fetched unfiltered so the filter controls are instant and switching
  // pages never costs a round-trip; narrowing happens below in `filtered`.
  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ limit: "800" });
    if (projectRef.current) params.set("projectId", projectRef.current);
    try {
      const data = await API.get<{ logs: LogRow[]; sources: string[] }>(
        `/api/logs?${params}`,
      );
      setLogs(data.logs);
      setServerSources(data.sources);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Re-reading the tail on a project switch is the point of the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void refresh();
  }, [refresh, activeProjectId]);

  useEffect(() => {
    return subscribeToEvents((type, data) => {
      if (type !== "log" || pausedRef.current) return;
      const row = data as LogRow;
      const project = projectRef.current;
      // A line written before its project was known still belongs here.
      if (project && row.projectId && row.projectId !== project) return;
      setLogs((prev) => {
        if (prev.some((l) => l.id === row.id)) return prev;
        return [row, ...prev].slice(0, MAX_BUFFER);
      });
    });
  }, []);

  const setFilters = useCallback((patch: Partial<LogFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const clear = useCallback(() => setLogs([]), []);

  const filtered = useMemo(() => {
    const needle = filters.q.trim().toLowerCase();
    return logs.filter((l) => {
      if (filters.level && l.level !== filters.level) return false;
      if (filters.source && l.source !== filters.source) return false;
      if (
        needle &&
        !`${l.message} ${l.source}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [logs, filters]);

  const sources = useMemo(() => {
    const set = new Set(serverSources);
    for (const l of logs) set.add(l.source);
    return [...set].sort();
  }, [serverSources, logs]);

  /* ----------------------------- traces ---------------------------- */

  const refreshTraces = useCallback(async () => {
    try {
      const params = projectRef.current
        ? `?projectId=${projectRef.current}`
        : "";
      const data = await API.get<{ traces: TraceSummary[] }>(
        `/api/logs/traces${params}`,
      );
      setTraces(data.traces);
      setSelectedTaskId((current) =>
        current && data.traces.some((t) => t.taskId === current)
          ? current
          : (data.traces[0]?.taskId ?? null),
      );
    } catch {
      setTraces([]);
    } finally {
      setTracesLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTracesLoading(true);
    void refreshTraces();
  }, [refreshTraces, activeProjectId]);

  useEffect(() => {
    return subscribeToEvents((type) => {
      if (
        type === "task:started" ||
        type === "task:completed" ||
        type === "task:failed"
      ) {
        void refreshTraces();
      }
    });
  }, [refreshTraces]);

  // Span trees are re-read whenever the selected run changes, and again
  // when a run finishes so a trace opened while it was still going fills
  // itself in.
  useEffect(() => {
    if (!selectedTaskId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSpans([]);
      return;
    }
    let cancelled = false;
    setSpansLoading(true);
    API.get<{ spans: SpanRow[] }>(`/api/logs/traces/${selectedTaskId}`)
      .then((d) => {
        if (!cancelled) setSpans(d.spans);
      })
      .catch(() => {
        if (!cancelled) setSpans([]);
      })
      .finally(() => {
        if (!cancelled) setSpansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId, traces]);

  const selectTrace = useCallback((taskId: string | null) => {
    setSelectedTaskId(taskId);
  }, []);

  const focusTrace = useCallback((taskId: string) => {
    setMode("traces");
    setSelectedTaskId(taskId);
  }, []);

  const value = useMemo<LogsContextValue>(
    () => ({
      logs,
      filtered,
      sources,
      loading,
      filters,
      setFilters,
      paused,
      setPaused,
      clear,
      refresh,
      mode,
      setMode,
      expandedLogId,
      setExpandedLogId,
      traces,
      tracesLoading,
      selectedTaskId,
      selectTrace,
      spans,
      spansLoading,
      focusTrace,
    }),
    [
      logs,
      filtered,
      sources,
      loading,
      filters,
      setFilters,
      paused,
      clear,
      refresh,
      mode,
      expandedLogId,
      traces,
      tracesLoading,
      selectedTaskId,
      selectTrace,
      spans,
      spansLoading,
      focusTrace,
    ],
  );

  return <LogsContext.Provider value={value}>{children}</LogsContext.Provider>;
}

export function useLogs(): LogsContextValue {
  const ctx = useContext(LogsContext);
  if (!ctx) throw new Error("useLogs must be used inside <LogsProvider>");
  return ctx;
}
