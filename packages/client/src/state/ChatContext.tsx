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
 * Chat lives here rather than inside ChatPage so that leaving the page
 * doesn't throw away work in progress.
 *
 * Two things used to go wrong when you navigated away mid-request: the
 * component unmounted while the POST was still open, so the reply landed
 * on a dead component and was lost; and remounting reset the selected
 * session to whichever one happened to be first, which read as separate
 * chats being shuffled together. Both are structural — the fix is for the
 * conversation to outlive the route.
 */

/**
 * One thing the harness did on the way to an answer — a tool call, a
 * thinking block, a token count. Mirrors HarnessEvent in
 * packages/shared/src/harness.ts, which is normalised across CLIs.
 */
export interface ActivityEvent {
  id: string;
  type:
    "status" | "text" | "thinking" | "tool" | "tool-result" | "usage" | "error";
  text?: string;
  tool?: string;
  callId?: string;
  detail?: string;
  status?: "running" | "completed" | "failed";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  at: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  harness?: string;
  model?: string;
  status?: "completed" | "failed";
  /** Set on assistant messages so the run can be opened in Logs. */
  taskId?: string;
  /** What the harness did to produce this — kept so it survives a reload. */
  activity?: ActivityEvent[];
  createdAt: number;
}

export interface ChatSession {
  /** Client-generated and sent to the server, so both sides agree on it. */
  id: string;
  /** The project this conversation belongs to; sessions never cross projects. */
  projectId: string | null;
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** Transient per-session state for a task that is currently running. */
export interface ChatRun {
  taskId: string | null;
  harness: string | null;
  phase: string | null;
  progress: string;
  startedAt: number;
  /** Live trail, appended to as the harness works. */
  activity: ActivityEvent[];
}

interface ChatContextValue {
  /** Sessions belonging to the active project, newest activity first. */
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  activeSessionId: string | null;
  runs: Record<string, ChatRun>;
  /**
   * What to run: "" routes automatically, `harness:<id>` pins a harness
   * and lets it choose its own model, anything else is a catalog id
   * (`harness/provider/model`) which pins both.
   */
  selection: string;
  setSelection: (selection: string) => void;
  selectSession: (id: string) => void;
  newSession: () => ChatSession;
  deleteSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  send: (text: string, sessionId?: string) => Promise<void>;
  isSending: (sessionId: string) => boolean;
  /** How many sessions have a task in flight, across every project. */
  busyCount: number;
}

interface ChatResponse {
  sessionId: string;
  taskId: string;
  status: "completed" | "failed";
  output: string;
  harness?: string;
  model?: string;
  events?: Array<Omit<ActivityEvent, "id">>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const STORAGE_KEY = "hive.chat.v3";
const LEGACY_KEY = "hive.chatSessions";
const NO_PROJECT = "__none__";

/** Phase ids come from the server's TaskPhase; keep the wording in step. */
const PHASE_LABEL: Record<string, string> = {
  intake: "Reading the request",
  bullpen: "Writing code",
  qa: "Running tests",
  conference: "Waiting for approval",
  shipping: "Committing the work",
  "server-room": "Building",
  "break-room": "Wrapping up",
};

interface PersistedState {
  sessions: ChatSession[];
  activeByProject: Record<string, string>;
  selection: string;
}

/** A long run emits hundreds of events; keep the tail. */
const MAX_ACTIVITY = 200;

/**
 * Read out of a plain object rather than off the ref inline: `send`
 * already guards on `runsRef.current[id]` being absent, and TypeScript
 * carries that narrowing forward through the whole function.
 */
function activityFor(
  runs: Record<string, ChatRun>,
  sessionId: string,
): ActivityEvent[] {
  return runs[sessionId]?.activity ?? [];
}

/**
 * Text blocks are already the message body, and full tool output can be
 * enormous — the stored trail keeps the shape of the work, not a second
 * copy of everything.
 */
function forStorage(events: ActivityEvent[]): ActivityEvent[] {
  return events
    .filter((e) => e.type !== "text")
    .slice(-60)
    .map((e) => ({
      ...e,
      text: e.text ? e.text.slice(0, 600) : undefined,
      detail: e.detail ? e.detail.slice(0, 300) : undefined,
    }));
}

function emptySession(projectId: string | null): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    projectId,
    name: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Read once per page load, not once per render. */
let cachedState: PersistedState | null = null;

function initialState(): PersistedState {
  if (!cachedState) cachedState = loadPersisted();
  return cachedState;
}

function loadPersisted(): PersistedState {
  const empty: PersistedState = {
    sessions: [],
    activeByProject: {},
    selection: "",
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        activeByProject: parsed.activeByProject ?? {},
        // Older builds stored a bare harness id under `pinnedHarness`.
        selection:
          parsed.selection ??
          ((parsed as { pinnedHarness?: string }).pinnedHarness
            ? `harness:${(parsed as { pinnedHarness?: string }).pinnedHarness}`
            : ""),
      };
    }

    // Conversations written by the pre-project version of this screen.
    // They have no project of their own; the first message sent in one
    // adopts whichever project is active then.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as Array<{
        id: string;
        name: string;
        messages: Array<Omit<ChatMessage, "createdAt">>;
      }>;
      const now = Date.now();
      return {
        ...empty,
        sessions: old.map((s) => ({
          id: s.id,
          projectId: null,
          name: s.name,
          createdAt: now,
          updatedAt: now,
          messages: (s.messages ?? []).map((m) => ({ ...m, createdAt: now })),
        })),
      };
    }
  } catch {
    // Corrupt or unavailable storage — start fresh.
  }

  return empty;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { activeProjectId } = useProjects();

  const [sessions, setSessions] = useState<ChatSession[]>(
    () => initialState().sessions,
  );
  const [activeByProject, setActiveByProject] = useState<
    Record<string, string>
  >(() => initialState().activeByProject);
  const [selection, setSelection] = useState(() => initialState().selection);
  const [runs, setRuns] = useState<Record<string, ChatRun>>({});

  const projectKey = activeProjectId ?? NO_PROJECT;

  // Read by send(), which must see the newest state even though the
  // callback itself was created during an earlier render.
  const sessionsRef = useRef(sessions);
  const runsRef = useRef(runs);
  const activeByProjectRef = useRef(activeByProject);
  const projectIdRef = useRef(activeProjectId);
  const selectionRef = useRef(selection);

  useEffect(() => {
    sessionsRef.current = sessions;
    runsRef.current = runs;
    activeByProjectRef.current = activeByProject;
    projectIdRef.current = activeProjectId;
    selectionRef.current = selection;
  }, [sessions, runs, activeByProject, activeProjectId, selection]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sessions, activeByProject, selection }),
      );
    } catch {
      // Not fatal — the conversation just won't survive a reload.
    }
  }, [sessions, activeByProject, selection]);

  /* ----------------------- session selection ----------------------- */

  // Sessions belong to exactly one project. Legacy ones (projectId null)
  // show everywhere until their first send stamps them.
  const visible = useMemo(
    () =>
      sessions
        .filter((s) => s.projectId === activeProjectId || s.projectId === null)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, activeProjectId],
  );

  const storedActiveId = activeByProject[projectKey];
  const activeSession =
    visible.find((s) => s.id === storedActiveId) ?? visible[0] ?? null;

  const selectSession = useCallback(
    (id: string) => {
      setActiveByProject((prev) => ({ ...prev, [projectKey]: id }));
    },
    [projectKey],
  );

  const newSession = useCallback(() => {
    const session = emptySession(projectIdRef.current);
    setSessions((prev) => [session, ...prev]);
    setActiveByProject((prev) => ({ ...prev, [projectKey]: session.id }));
    return session;
  }, [projectKey]);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveByProject((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(next)) {
        if (value === id) delete next[key];
      }
      return next;
    });
  }, []);

  const renameSession = useCallback((id: string, name: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, name, updatedAt: Date.now() } : s,
      ),
    );
  }, []);

  const patchSession = useCallback(
    (id: string, fn: (s: ChatSession) => ChatSession) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
    },
    [],
  );

  /* --------------------------- sending ----------------------------- */

  const send = useCallback(
    async (text: string, sessionId?: string) => {
      const prompt = text.trim();
      if (!prompt) return;

      // Resolve the target session up front: the reply is applied to this
      // id no matter which session (or page) is on screen when it lands.
      const currentProject = projectIdRef.current;
      let target: ChatSession | null = sessionId
        ? (sessionsRef.current.find((s) => s.id === sessionId) ?? null)
        : null;

      if (!target) {
        const preferred =
          activeByProjectRef.current[currentProject ?? NO_PROJECT];
        target =
          sessionsRef.current.find((s) => s.id === preferred) ??
          sessionsRef.current.find(
            (s) => s.projectId === currentProject || s.projectId === null,
          ) ??
          null;
      }

      if (!target) {
        const created = emptySession(currentProject);
        target = created;
        setSessions((prev) => [created, ...prev]);
        setActiveByProject((prev) => ({
          ...prev,
          [currentProject ?? NO_PROJECT]: created.id,
        }));
      }

      const targetId = target.id;
      if (runsRef.current[targetId]) return; // already busy

      const projectId = target.projectId ?? currentProject;
      // "" → route automatically; "harness:x" → pin the harness only;
      // otherwise a catalog id, which names the harness *and* the model.
      const choice = selectionRef.current;
      const harness = choice.startsWith("harness:")
        ? choice.slice("harness:".length)
        : "";
      const model = choice && !choice.startsWith("harness:") ? choice : "";
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        createdAt: Date.now(),
      };

      patchSession(targetId, (s) => ({
        ...s,
        projectId,
        name: s.messages.length === 0 ? prompt.slice(0, 48) : s.name,
        messages: [...s.messages, userMsg],
        updatedAt: Date.now(),
      }));
      setRuns((prev) => ({
        ...prev,
        [targetId]: {
          taskId: null,
          harness: harness || null,
          phase: null,
          progress: "Sending…",
          startedAt: Date.now(),
          activity: [],
        },
      }));

      try {
        // The server expects `message` and answers with `output`. The
        // session id travels with every message, so the server never has
        // to invent one and two chats can't end up sharing a history.
        const data = await API.post<ChatResponse>("/api/chat", {
          message: prompt,
          sessionId: targetId,
          harness: harness || undefined,
          model: model || undefined,
          projectId: projectId ?? undefined,
        });

        // Prefer the server's own trail: it is complete even if an SSE
        // event was missed while the page was backgrounded.
        const live = activityFor(runsRef.current, targetId);
        const trail: ActivityEvent[] = data.events
          ? data.events.map((e, i) => ({ ...e, id: `${data.taskId}:${i}` }))
          : live;
        patchSession(targetId, (s) => ({
          ...s,
          messages: [
            ...s.messages,
            {
              id: data.taskId,
              role: "assistant",
              content: data.output,
              status: data.status,
              harness: data.harness,
              model: data.model,
              taskId: data.taskId,
              activity: forStorage(trail),
              createdAt: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        }));
      } catch (err) {
        patchSession(targetId, (s) => ({
          ...s,
          messages: [
            ...s.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content:
                err instanceof Error
                  ? err.message
                  : "Could not reach the Hive server.",
              status: "failed",
              activity: forStorage(activityFor(runsRef.current, targetId)),
              createdAt: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        }));
      } finally {
        setRuns((prev) => {
          const next = { ...prev };
          delete next[targetId];
          return next;
        });
      }
    },
    [patchSession],
  );

  /* --------------------------- progress ---------------------------- */

  // One long-lived subscription for the whole app: progress keeps
  // updating while you are on another screen, and is still accurate when
  // you come back.
  useEffect(() => {
    return subscribeToEvents((type, data) => {
      const d = data as
        | {
            sessionId?: string;
            taskId?: string;
            harness?: string;
            phase?: string;
          }
        | undefined;
      const sessionId = d?.sessionId;
      if (!sessionId || !runsRef.current[sessionId]) return;

      setRuns((prev) => {
        const run = prev[sessionId];
        if (!run) return prev;

        if (type === "task:started") {
          return {
            ...prev,
            [sessionId]: {
              ...run,
              taskId: d?.taskId ?? run.taskId,
              progress: "Picking an agent…",
            },
          };
        }
        if (type === "agent:update") {
          const phase = d?.phase ?? run.phase;
          const label = phase ? (PHASE_LABEL[phase] ?? phase) : "Working";
          return {
            ...prev,
            [sessionId]: {
              ...run,
              taskId: d?.taskId ?? run.taskId,
              harness: d?.harness ?? run.harness,
              phase,
              progress: d?.harness ? `${d.harness} · ${label}` : label,
            },
          };
        }
        if (type === "agent:activity") {
          const incoming = (d as { event?: Omit<ActivityEvent, "id"> }).event;
          if (!incoming) return prev;
          const entry: ActivityEvent = {
            ...incoming,
            id: `${run.taskId ?? sessionId}:${run.activity.length}`,
          };
          const activity = [...run.activity, entry].slice(-MAX_ACTIVITY);
          // A tool call is the most informative thing to show while it
          // runs, so it doubles as the progress line.
          const progress =
            entry.type === "tool"
              ? `Running ${entry.tool ?? "a tool"}…`
              : entry.type === "thinking"
                ? "Thinking…"
                : run.progress;
          return { ...prev, [sessionId]: { ...run, activity, progress } };
        }
        if (type === "task:completed" || type === "task:failed") {
          return {
            ...prev,
            [sessionId]: { ...run, progress: "Finishing up…" },
          };
        }
        return prev;
      });
    });
  }, []);

  const isSending = useCallback(
    (sessionId: string) => Boolean(runs[sessionId]),
    [runs],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      sessions: visible,
      activeSession,
      activeSessionId: activeSession?.id ?? null,
      runs,
      selection,
      setSelection,
      selectSession,
      newSession,
      deleteSession,
      renameSession,
      send,
      isSending,
      busyCount: Object.keys(runs).length,
    }),
    [
      visible,
      activeSession,
      runs,
      selection,
      selectSession,
      newSession,
      deleteSession,
      renameSession,
      send,
      isSending,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}
