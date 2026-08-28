import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { API } from "../lib/api";
import { Button, IconButton, Modal, PageHeader } from "../components/ui";
import { SessionsPane } from "./memory/SessionsPane";
import { KeysPane } from "./memory/KeysPane";
import { ValuePane } from "./memory/ValuePane";
import type {
  MemoryEntry,
  MemoryEntrySummary,
  MemorySessionSummary,
} from "./memory/types";
import { useStickyState } from "../lib/useStickyState";

/**
 * Three-pane browser over the shared key/value store: sessions, the keys
 * inside one, and the value itself. Memory is global to the server rather
 * than per-project — a session belongs to a chat, not a repository — so
 * this screen deliberately isn't scoped to the active project.
 */
export function MemoryPage() {
  const [sessions, setSessions] = useState<MemorySessionSummary[]>([]);
  const [entries, setEntries] = useState<MemoryEntrySummary[]>([]);
  const [entry, setEntry] = useState<MemoryEntry | null>(null);

  // Coming back to this screen lands you on the same session and key
  // you were reading, rather than back at the top of the list.
  const [sessionId, setSessionId] = useStickyState<string | null>(
    "memory.sessionId",
    null,
  );
  const [entryKey, setEntryKey] = useStickyState<string | null>(
    "memory.entryKey",
    null,
  );

  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [loadingValue, setLoadingValue] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await API.get<MemorySessionSummary[]>(
        "/api/memory/sessions",
      );
      setSessions(data);
      setSessionId((current) =>
        current && data.some((s) => s.sessionId === current)
          ? current
          : (data[0]?.sessionId ?? null),
      );
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, [setSessionId]);

  const loadEntries = useCallback(
    async (id: string | null) => {
      if (!id) {
        setEntries([]);
        setEntryKey(null);
        return;
      }
      setLoadingEntries(true);
      try {
        const data = await API.get<MemoryEntrySummary[]>(
          `/api/memory/${encodeURIComponent(id)}`,
        );
        setEntries(data);
        setEntryKey((current) =>
          current && data.some((e) => e.key === current)
            ? current
            : (data[0]?.key ?? null),
        );
      } catch {
        setEntries([]);
        setEntryKey(null);
      } finally {
        setLoadingEntries(false);
      }
    },
    [setEntryKey],
  );

  const loadValue = useCallback(
    async (id: string | null, key: string | null) => {
      if (!id || !key) {
        setEntry(null);
        return;
      }
      setLoadingValue(true);
      try {
        setEntry(
          await API.get<MemoryEntry>(
            `/api/memory/${encodeURIComponent(id)}/${encodeURIComponent(key)}`,
          ),
        );
      } catch {
        setEntry(null);
      } finally {
        setLoadingValue(false);
      }
    },
    [],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEntries(sessionId);
  }, [sessionId, loadEntries]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadValue(sessionId, entryKey);
  }, [sessionId, entryKey, loadValue]);

  const handleSave = useCallback(
    async (value: string) => {
      if (!sessionId || !entryKey) return;
      await API.put(
        `/api/memory/${encodeURIComponent(sessionId)}/${encodeURIComponent(entryKey)}`,
        { value },
      );
      await Promise.all([
        loadEntries(sessionId),
        loadValue(sessionId, entryKey),
      ]);
    },
    [sessionId, entryKey, loadEntries, loadValue],
  );

  const handleDelete = useCallback(async () => {
    if (!sessionId || !entryKey) return;
    await API.del(
      `/api/memory/${encodeURIComponent(sessionId)}/${encodeURIComponent(entryKey)}`,
    );
    setEntryKey(null);
    setEntry(null);
    await Promise.all([loadEntries(sessionId), loadSessions()]);
  }, [sessionId, entryKey, loadEntries, loadSessions, setEntryKey]);

  const handleClearSession = useCallback(async () => {
    if (!sessionId) return;
    await API.del(`/api/memory/${encodeURIComponent(sessionId)}`);
    setClearOpen(false);
    setEntryKey(null);
    setEntry(null);
    await loadSessions();
  }, [sessionId, loadSessions, setEntryKey]);

  const totalSize = sessions.reduce((sum, s) => sum + s.totalSize, 0);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Direct"
          title="Memory"
          description="What agents have written down and can read back on the next run."
          actions={
            <div className="flex items-center gap-3">
              {sessions.length > 0 ? (
                <span className="text-[12px] text-muted" data-numeric>
                  {sessions.length}{" "}
                  {sessions.length === 1 ? "session" : "sessions"} ·{" "}
                  {formatBytes(totalSize)}
                </span>
              ) : null}
              <IconButton
                onClick={() => void loadSessions()}
                aria-label="Refresh memory"
              >
                <RefreshCw
                  className={loadingSessions ? "size-4 animate-spin" : "size-4"}
                />
              </IconButton>
            </div>
          }
        />
      </div>

      <div className="flex-1 min-h-0 flex border-t border-line">
        <SessionsPane
          sessions={sessions}
          loading={loadingSessions}
          selectedSessionId={sessionId}
          onSelect={setSessionId}
          className="w-64 shrink-0 border-r border-line"
        />
        <KeysPane
          sessionId={sessionId}
          entries={entries}
          loading={loadingEntries}
          selectedKey={entryKey}
          onSelect={setEntryKey}
          onRequestClear={() => setClearOpen(true)}
          className="w-72 shrink-0 border-r border-line"
        />
        <ValuePane
          sessionId={sessionId}
          entryKey={entryKey}
          entry={entry}
          loading={loadingValue}
          onSave={handleSave}
          onDelete={handleDelete}
          className="flex-1 min-w-0"
        />
      </div>

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear this session?"
        description={`Every entry in ${sessionId ?? ""} is deleted. This can't be undone.`}
        width="sm"
        footer={
          <>
            <Button onClick={() => setClearOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleClearSession()}>
              Clear session
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">
          {entries.length} {entries.length === 1 ? "entry" : "entries"} will be
          removed from disk.
        </p>
      </Modal>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
