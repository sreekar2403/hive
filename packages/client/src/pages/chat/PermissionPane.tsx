import { useEffect, useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { ApprovalsStore, type PendingPermission } from "../office/approvals";
import { subscribeToEvents } from "../../lib/api";
import { Badge, Button } from "../../components/ui";

/**
 * Inline Approve/Deny pane for the chat window.
 *
 * The approval gate already broadcasts `permission:request` and serves
 * GET /api/permissions — but only the Office Floor and the Permissions
 * page listened, so a person chatting never saw the request, the timeout
 * lapsed, and the run died with "denied (or nobody answered in time)".
 * This pane subscribes the active chat to its own session's requests and
 * settles them through the same endpoints, so approving re-runs the task
 * with the command allowed exactly as before.
 *
 * On timeout the server appends the denied message to the chat thread
 * itself, so no client-side timeout note is needed here — the pane simply
 * stops showing the request on the next poll.
 */

/** m:ss countdown, clamped at zero. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function useSessionPermissions(sessionId: string | null) {
  const store = useMemo(
    () => (sessionId ? new ApprovalsStore(sessionId) : null),
    [sessionId],
  );
  const [pending, setPending] = useState<PendingPermission[]>([]);

  useEffect(() => {
    // No store means no session: nothing can be pending. (The pane is
    // keyed by session in ChatPage, so a session switch remounts with a
    // fresh empty list rather than carrying the old chat's requests.)
    if (!store || !sessionId) return;
    const unsub = store.subscribe(setPending);
    void store.refresh();
    // Tighter than the Office Floor's 5s: the run is blocked on this.
    store.startPolling(3000);
    const unsubEvents = subscribeToEvents((type, data) => {
      if (type !== "permission:request" && type !== "permission:resolved") {
        return;
      }
      const sid = (data as { sessionId?: string } | null)?.sessionId;
      if (!sid || sid === sessionId) void store.refresh();
    });
    return () => {
      unsub();
      unsubEvents();
      store.stopPolling();
    };
  }, [store, sessionId]);

  return {
    pending,
    approve: (id: string) => store?.approve(id) ?? Promise.resolve(false),
    deny: (id: string) => store?.deny(id) ?? Promise.resolve(false),
  };
}

export function PermissionPane({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const { pending, approve, deny } = useSessionPermissions(sessionId);
  const [busy, setBusy] = useState<string | null>(null);
  // Re-render once a second while a request is up, for the countdown.
  // `now` lives in state (not Date.now() in render) so the component
  // stays pure under the react-hooks purity rule.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending.length]);

  if (!sessionId || pending.length === 0) return null;

  const settle = async (id: string, verb: "approve" | "deny") => {
    setBusy(id);
    try {
      await (verb === "approve" ? approve(id) : deny(id));
    } finally {
      setBusy((b) => (b === id ? null : b));
    }
  };

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {pending.map((request) => {
        const remaining =
          request.timeoutAt != null ? request.timeoutAt - now : null;
        const expired = remaining != null && remaining <= 0;
        return (
          <div
            key={request.id}
            role="dialog"
            aria-label="Permission request"
            className="rounded-lg border border-warn bg-warn-soft px-3.5 py-2.5 text-[13px]"
          >
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="size-4 text-warn" />
              <span className="font-medium">Approval needed</span>
              {remaining != null ? (
                <Badge tone={expired ? "danger" : "warn"}>
                  {expired ? "expired" : `${formatRemaining(remaining)} left`}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted mb-1.5">{request.description}</p>
            {request.command ? (
              <pre className="font-mono text-[12px] px-2 py-1 mb-2 rounded border border-line bg-surface-2 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                {request.command}
              </pre>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="default"
                size="sm"
                disabled={busy === request.id}
                onClick={() => void settle(request.id, "deny")}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy === request.id}
                onClick={() => void settle(request.id, "approve")}
              >
                Approve
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
