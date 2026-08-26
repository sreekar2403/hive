import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderGit2,
  Globe,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Waypoints,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  StatusDot,
  Textarea,
} from "../components/ui";
import { useChat, type ChatMessage } from "../state/ChatContext";
import { useLogs } from "../state/LogsContext";
import { useProjects } from "../state/ProjectContext";
import { ModelPicker } from "./chat/ModelPicker";
import { ActivityTrail } from "./chat/ActivityTrail";
import { SoulSuggestions } from "./chat/SoulSuggestions";
import { Markdown } from "../components/Markdown";
import { cn } from "../lib/cn";

/*
  Openers differ by scope. Pointed at a repository the useful suggestion
  is a change to that code; in the General workspace there is no code to
  point at, so they are questions instead — which is the whole reason
  that scope exists.
*/
const PROJECT_EXAMPLES = [
  "Add tests for the router's keyword matching",
  "Explain how the loop engine decides to retry",
  "Rename detectFilesChanged to listChangedFiles across the server",
];

const GENERAL_EXAMPLES = [
  "Explain the difference between rebase and merge",
  "Write a cron expression for every weekday at 18:00",
  "Draft a shell script that prunes Docker images older than a week",
];

/**
 * Draft text and scroll offset are per session and only interesting while
 * the app is open, so they live here rather than in the persisted store —
 * but outside the component, so switching pages doesn't wipe them.
 */
const drafts = new Map<string, string>();
const scrollOffsets = new Map<string, number>();

export function ChatPage() {
  const {
    sessions,
    activeSession,
    runs,
    selection,
    setSelection,
    selectSession,
    newSession,
    deleteSession,
    send,
  } = useChat();
  const { focusTrace } = useLogs();
  const { activeProject, isGeneralWorkspace } = useProjects();
  const navigate = useNavigate();

  const examples = isGeneralWorkspace ? GENERAL_EXAMPLES : PROJECT_EXAMPLES;

  const activeId = activeSession?.id ?? null;
  const run = activeId ? (runs[activeId] ?? null) : null;
  const sending = Boolean(run);

  const [input, setInput] = useState(() =>
    activeId ? (drafts.get(activeId) ?? "") : "",
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSessionRef = useRef<string | null>(activeId);

  // Swapping sessions swaps drafts with them.
  useEffect(() => {
    if (lastSessionRef.current === activeId) return;
    const previous = lastSessionRef.current;
    if (previous) drafts.set(previous, input);
    lastSessionRef.current = activeId;
    setInput(activeId ? (drafts.get(activeId) ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const updateInput = useCallback(
    (value: string) => {
      setInput(value);
      if (activeId) drafts.set(activeId, value);
    },
    [activeId],
  );

  // Restore where the reader was before they left the page; new messages
  // still pin the view to the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeId) return;
    const saved = scrollOffsets.get(activeId);
    el.scrollTop = saved ?? el.scrollHeight;
  }, [activeId]);

  const messageCount = activeSession?.messages.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight });
  }, [messageCount, run?.progress]);

  const submit = useCallback(() => {
    if (!input.trim() || sending) return;
    const text = input;
    updateInput("");
    void send(text, activeId ?? undefined);
  }, [input, sending, updateInput, send, activeId]);

  const retry = useCallback(
    (index: number) => {
      const prior = activeSession?.messages[index - 1];
      if (prior?.role === "user") void send(prior.content, activeId ?? undefined);
    },
    [activeSession, send, activeId],
  );

  const openTrace = useCallback(
    (taskId: string) => {
      focusTrace(taskId);
      navigate("/logs");
    },
    [focusTrace, navigate],
  );

  return (
    <div className="h-full flex">
      {/* Sessions */}
      <aside className="w-64 shrink-0 border-r border-line bg-surface flex flex-col">
        <div className="p-2 border-b border-line flex flex-col gap-2">
          <Button variant="primary" className="w-full" onClick={() => newSession()}>
            <Plus className="size-4" />
            New chat
          </Button>
          {/* Conversations never cross scopes, so which one you are in is
              the single most important thing this list needs to say. */}
          <div
            className="flex items-center gap-1.5 px-1 min-w-0"
            title={activeProject?.path ?? undefined}
          >
            {isGeneralWorkspace ? (
              <Globe className="size-3 text-accent shrink-0" />
            ) : (
              <FolderGit2 className="size-3 text-faint shrink-0" />
            )}
            <span className="eyebrow truncate">
              {activeProject?.name ?? "No scope"}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-faint">
              {isGeneralWorkspace
                ? "No general conversations yet."
                : "No conversations in this project yet."}
            </p>
          ) : null}
          {sessions.map((s) => {
            const busy = Boolean(runs[s.id]);
            return (
              <div
                key={s.id}
                className={cn(
                  "group w-full flex items-start gap-2 px-2 py-2 rounded-md transition-colors",
                  s.id === activeId
                    ? "bg-accent-soft text-ink"
                    : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <button
                  onClick={() => selectSession(s.id)}
                  className="flex-1 min-w-0 flex items-start gap-2 text-left"
                >
                  {busy ? (
                    <span className="mt-1">
                      <StatusDot tone="accent" pulse />
                    </span>
                  ) : (
                    <MessageSquare
                      className={cn(
                        "size-3.5 shrink-0 mt-0.5",
                        s.id === activeId ? "text-accent" : "text-faint",
                      )}
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[13px] truncate">{s.name}</span>
                    <span className="block font-mono text-[10px] text-faint">
                      {busy
                        ? "running…"
                        : `${s.messages.length} ${
                            s.messages.length === 1 ? "message" : "messages"
                          }`}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => deleteSession(s.id)}
                  className="opacity-0 group-hover:opacity-100 text-faint hover:text-danger transition-opacity"
                  aria-label={`Delete ${s.name}`}
                  disabled={busy}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        {/* Pending soul.md suggestions surface here, next to the
            conversations they came out of. */}
        <div className="border-t border-line p-2 max-h-72 overflow-y-auto">
          <SoulSuggestions projectId={activeProject?.id ?? null} />
        </div>
      </aside>

      {/* Conversation */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            if (activeId) scrollOffsets.set(activeId, e.currentTarget.scrollTop);
          }}
          className="flex-1 overflow-y-auto"
        >
          {!activeSession || activeSession.messages.length === 0 ? (
            <EmptyState
              icon={isGeneralWorkspace ? <Globe /> : <MessageSquare />}
              title={
                isGeneralWorkspace ? "Ask anything" : "Put the swarm to work"
              }
              description={
                isGeneralWorkspace
                  ? "This scope belongs to no repository, so nothing you ask here can touch your projects. Good for questions, scratch scripts and working something out."
                  : "Describe a change and Hive picks the right agent for it, then runs until it succeeds."
              }
              action={
                <div className="flex flex-col gap-1.5 items-stretch max-w-md">
                  {examples.map((e) => (
                    <button
                      key={e}
                      onClick={() => void send(e, activeId ?? undefined)}
                      className="text-left text-[13px] text-muted px-3 py-2 rounded-md border border-line hover:border-line-strong hover:text-ink hover:bg-surface-2 transition-colors"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              }
            />
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-4">
              {activeSession.messages.map((m, i) => (
                <Message
                  key={m.id}
                  message={m}
                  onRetry={() => retry(i)}
                  onOpenTrace={openTrace}
                />
              ))}
              {run ? (
                <div className="flex flex-col gap-2 items-start">
                  <div className="flex items-center gap-2 text-[13px] text-muted">
                    <StatusDot tone="accent" pulse />
                    {run.progress}
                    <span className="font-mono text-[11px] text-faint">
                      keeps running if you switch pages
                    </span>
                  </div>
                  {/* What it is doing right now, not just that it is busy. */}
                  <ActivityTrail events={run.activity} live />
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-line bg-surface px-6 py-3">
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <Textarea
                rows={2}
                value={input}
                onChange={(e) => updateInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Describe the change you want…"
                disabled={sending}
                className="flex-1"
              />
              <Button
                variant="primary"
                onClick={submit}
                disabled={!input.trim() || sending}
                aria-label="Send"
                className="h-9"
              >
                <Send className="size-4" />
                {sending ? "Working…" : "Send"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="eyebrow">Run with</span>
              <ModelPicker
                value={selection}
                onChange={setSelection}
                disabled={sending}
              />
              <span className="text-[11px] text-faint ml-auto">
                Enter sends · Shift+Enter for a new line
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({
  message,
  onRetry,
  onOpenTrace,
}: {
  message: ChatMessage;
  onRetry: () => void;
  onOpenTrace: (taskId: string) => void;
}) {
  const failed = message.status === "failed";

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3.5 py-2 rounded-lg bg-accent text-accent-fg text-[13px] whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 items-start">
      <div className="flex items-center gap-2">
        <Badge tone={failed ? "danger" : "neutral"}>
          {failed ? "Failed" : (message.harness ?? "assistant")}
        </Badge>
        {message.model ? (
          <span className="font-mono text-[10px] text-faint">{message.model}</span>
        ) : null}
        {failed ? (
          <IconButton size="sm" onClick={onRetry} aria-label="Try again">
            <RotateCcw className="size-3.5" />
          </IconButton>
        ) : null}
        {message.taskId ? (
          <button
            onClick={() => onOpenTrace(message.taskId!)}
            className="flex items-center gap-1 text-[11px] text-faint hover:text-accent transition-colors"
          >
            <Waypoints className="size-3" />
            View trace
          </button>
        ) : null}
      </div>
      <div
        className={cn(
          "max-w-[85%] px-3.5 py-2.5 rounded-lg border text-[13px] break-words",
          failed
            ? "bg-danger-soft border-danger text-danger"
            : "bg-surface border-line text-ink",
        )}
      >
        <Markdown>{message.content || "(no output)"}</Markdown>
      </div>
      {message.activity?.length ? (
        <ActivityTrail events={message.activity} />
      ) : null}
    </div>
  );
}

/** Terminal-ish output reads better monospaced. */

