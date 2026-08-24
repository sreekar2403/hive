import { useState } from "react";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  Coins,
  Info,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { ActivityEvent } from "../../state/ChatContext";

/**
 * What the agent did on the way to its answer: thinking, tool calls and
 * their results, token spend. Live while a task runs, and folded away —
 * but still there — once it finishes.
 *
 * Text events are deliberately not shown: they are the answer itself,
 * which is rendered as the message.
 */

const ICON: Record<string, typeof Info> = {
  thinking: Brain,
  tool: Wrench,
  "tool-result": Wrench,
  usage: Coins,
  error: AlertCircle,
  status: Info,
};

function visible(events: ActivityEvent[]): ActivityEvent[] {
  return events.filter((e) => e.type !== "text");
}

export function ActivityTrail({
  events,
  live,
}: {
  events: ActivityEvent[];
  live?: boolean;
}) {
  const rows = visible(events);
  const [open, setOpen] = useState(Boolean(live));

  if (rows.length === 0) return null;

  const toolCount = rows.filter((e) => e.type === "tool").length;
  const thoughtCount = rows.filter((e) => e.type === "thinking").length;
  const summary = [
    toolCount ? `${toolCount} tool call${toolCount === 1 ? "" : "s"}` : null,
    thoughtCount
      ? `${thoughtCount} thought${thoughtCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="w-full max-w-[85%]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-faint hover:text-muted transition-colors"
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        {summary || `${rows.length} steps`}
      </button>

      {open ? (
        <ul className="mt-1.5 flex flex-col gap-1 border-l border-line pl-3">
          {rows.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ICON[event.type] ?? Info;

  const failed = event.status === "failed" || event.type === "error";
  const body =
    event.type === "usage"
      ? formatUsage(event)
      : (event.text ?? event.detail ?? "");
  const long = body.length > 140;

  return (
    <li className="flex items-start gap-1.5 text-[11px] leading-relaxed">
      <Icon
        className={cn(
          "size-3 mt-0.5 shrink-0",
          failed
            ? "text-danger"
            : event.type === "thinking"
              ? "text-info"
              : "text-faint",
        )}
      />
      <div className="min-w-0 flex-1">
        {event.tool ? (
          <span
            className={cn(
              "font-mono",
              event.type === "tool-result"
                ? failed
                  ? "text-danger"
                  : "text-muted"
                : "text-ink",
            )}
          >
            {event.type === "tool-result" ? "→ " : ""}
            {event.tool}
          </span>
        ) : null}
        {body ? (
          <span
            className={cn(
              "text-muted",
              event.tool && " ml-1.5",
              event.type === "thinking" && "italic",
            )}
          >
            {expanded || !long ? body : `${body.slice(0, 140)}…`}
            {long ? (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="ml-1 text-faint hover:text-accent"
              >
                {expanded ? "less" : "more"}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function formatUsage(event: ActivityEvent): string {
  const u = event.usage;
  if (!u) return "";
  const parts: string[] = [];
  if (u.totalTokens) parts.push(`${u.totalTokens.toLocaleString()} tokens`);
  else if (u.outputTokens) parts.push(`${u.outputTokens.toLocaleString()} out`);
  if (u.costUsd) parts.push(`$${u.costUsd.toFixed(4)}`);
  return parts.join(" · ");
}
