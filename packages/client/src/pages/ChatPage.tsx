import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Plus, RotateCcw, Send } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Select,
  StatusDot,
  Textarea,
} from "../components/ui";
import { API, subscribeToEvents } from "../lib/api";
import { cn } from "../lib/cn";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  harness?: string;
  status?: "completed" | "failed";
}

interface ChatSession {
  id: string;
  /** Null until the server assigns one on the first send. */
  serverId: string | null;
  name: string;
  messages: ChatMessage[];
}

interface ChatResponse {
  sessionId: string;
  taskId: string;
  status: "completed" | "failed";
  output: string;
}

const STORAGE_KEY = "hive.chatSessions";
const EXAMPLES = [
  "Add tests for the router's keyword matching",
  "Explain how the loop engine decides to retry",
  "Rename detectFilesChanged to listChangedFiles across the server",
];

function newSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    serverId: null,
    name: "New chat",
    messages: [],
  };
}

export function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as ChatSession[]) : [];
      if (parsed.length) return parsed;
    } catch {
      // Corrupt or unavailable storage — start fresh.
    }
    return [newSession()];
  });
  const [activeId, setActiveId] = useState(() => sessions[0].id);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pinnedHarness, setPinnedHarness] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // Not fatal — the conversation just won't survive a reload.
    }
  }, [sessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messages.length, progress]);

  // Live progress while a task runs, so the UI isn't frozen mid-request.
  useEffect(() => {
    if (!sending) return;
    const unsubscribe = subscribeToEvents((type, data) => {
      const d = data as { harness?: string; phase?: string } | undefined;
      if (type === "task:started") setProgress("Routing to a harness…");
      if (type === "agent:update") {
        setProgress(
          d?.harness ? `${d.harness} working${d.phase ? ` · ${d.phase}` : ""}` : "Working…",
        );
      }
    });
    return unsubscribe;
  }, [sending]);

  const patchActive = useCallback(
    (fn: (s: ChatSession) => ChatSession) => {
      setSessions((prev) => prev.map((s) => (s.id === activeId ? fn(s) : s)));
    },
    [activeId],
  );

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || sending) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
      };
      patchActive((s) => ({
        ...s,
        name: s.messages.length === 0 ? prompt.slice(0, 40) : s.name,
        messages: [...s.messages, userMsg],
      }));
      setInput("");
      setSending(true);
      setProgress("Sending…");

      try {
        // The server expects `message` and answers with `output`.
        const data = await API.post<ChatResponse>("/api/chat", {
          message: prompt,
          sessionId: active?.serverId ?? undefined,
          harness: pinnedHarness || undefined,
        });
        patchActive((s) => ({
          ...s,
          serverId: data.sessionId,
          messages: [
            ...s.messages,
            {
              id: data.taskId,
              role: "assistant",
              content: data.output,
              status: data.status,
            },
          ],
        }));
      } catch (err) {
        patchActive((s) => ({
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
            },
          ],
        }));
      } finally {
        setSending(false);
        setProgress(null);
      }
    },
    [active?.serverId, patchActive, pinnedHarness, sending],
  );

  const retry = useCallback(
    (index: number) => {
      const prior = active?.messages[index - 1];
      if (prior?.role === "user") void send(prior.content);
    },
    [active?.messages, send],
  );

  return (
    <div className="h-full flex">
      {/* Sessions */}
      <aside className="w-64 shrink-0 border-r border-line bg-surface flex flex-col">
        <div className="p-2 border-b border-line">
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              const s = newSession();
              setSessions((prev) => [s, ...prev]);
              setActiveId(s.id);
            }}
          >
            <Plus className="size-4" />
            New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={cn(
                "w-full flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors",
                s.id === activeId
                  ? "bg-accent-soft text-ink"
                  : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <MessageSquare
                className={cn(
                  "size-3.5 shrink-0 mt-0.5",
                  s.id === activeId ? "text-accent" : "text-faint",
                )}
              />
              <span className="min-w-0">
                <span className="block text-[13px] truncate">{s.name}</span>
                <span className="block font-mono text-[10px] text-faint">
                  {s.messages.length}{" "}
                  {s.messages.length === 1 ? "message" : "messages"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Conversation */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!active || active.messages.length === 0 ? (
            <EmptyState
              icon={<MessageSquare />}
              title="Put the swarm to work"
              description="Describe a change and Hive picks the right agent for it, then runs until it succeeds."
              action={
                <div className="flex flex-col gap-1.5 items-stretch max-w-md">
                  {EXAMPLES.map((e) => (
                    <button
                      key={e}
                      onClick={() => void send(e)}
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
              {active.messages.map((m, i) => (
                <Message key={m.id} message={m} onRetry={() => retry(i)} />
              ))}
              {progress ? (
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <StatusDot tone="accent" pulse />
                  {progress}
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
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Describe the change you want…"
                disabled={sending}
                className="flex-1"
              />
              <Button
                variant="primary"
                onClick={() => void send(input)}
                disabled={!input.trim() || sending}
                aria-label="Send"
                className="h-9"
              >
                <Send className="size-4" />
                {sending ? "Working…" : "Send"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="eyebrow">Harness</span>
              <Select
                value={pinnedHarness}
                onChange={(e) => setPinnedHarness(e.target.value)}
                className="h-7 text-[12px] w-40"
                aria-label="Pin a harness for the next message"
              >
                <option value="">Choose automatically</option>
                <option value="opencode">opencode</option>
                <option value="claude-code">claude-code</option>
                <option value="pi">pi</option>
              </Select>
              <span className="text-[11px] text-faint">
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
}: {
  message: ChatMessage;
  onRetry: () => void;
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
        {failed ? (
          <IconButton size="sm" onClick={onRetry} aria-label="Try again">
            <RotateCcw className="size-3.5" />
          </IconButton>
        ) : null}
      </div>
      <div
        className={cn(
          "max-w-[85%] px-3.5 py-2.5 rounded-lg border text-[13px] whitespace-pre-wrap break-words",
          failed
            ? "bg-danger-soft border-danger text-danger"
            : "bg-surface border-line text-ink",
          looksLikeOutput(message.content) && "font-mono text-[12px]",
        )}
      >
        {message.content || "(no output)"}
      </div>
    </div>
  );
}

/** Terminal-ish output reads better monospaced. */
function looksLikeOutput(text: string): boolean {
  return (
    text.includes("\n") &&
    /(\$ |npm |pnpm |error|Error|\bat \w+|\.ts:|\.tsx:)/.test(text)
  );
}
