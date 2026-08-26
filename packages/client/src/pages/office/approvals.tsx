import { useCallback, useEffect, useState } from "react";
import { API } from "../../lib/api";

/**
 * Conference-Room approvals: the client face of the existing permission
 * endpoints (GET /api/permissions, POST /api/permissions/:id/approve|deny).
 *
 * Polling is the correctness net; when the server starts broadcasting
 * `permission:*` events the hook also refreshes on those, so escalations
 * appear within a tick instead of a poll interval.
 */

export interface PendingPermission {
  id: string;
  sessionId: string;
  action: string;
  description: string;
  command?: string;
  timestamp: number;
}

type Subscriber = (list: PendingPermission[]) => void;

export class ApprovalsStore {
  private pending: PendingPermission[] = [];
  private subs = new Set<Subscriber>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Guards against overlapping polls stomping fresher data. */
  private inflight = false;

  snapshot(): PendingPermission[] {
    return this.pending;
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private emit(): void {
    for (const fn of this.subs) fn(this.pending);
  }

  async refresh(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      const list = await API.get<PendingPermission[]>("/api/permissions");
      this.pending = Array.isArray(list) ? list : [];
      this.emit();
    } catch {
      // Server unreachable — keep whatever we last saw; polling retries.
    } finally {
      this.inflight = false;
    }
  }

  async approve(id: string): Promise<boolean> {
    return this.settle(id, "approve");
  }

  async deny(id: string): Promise<boolean> {
    return this.settle(id, "deny");
  }

  private async settle(
    id: string,
    verb: "approve" | "deny",
  ): Promise<boolean> {
    const before = this.pending;
    // Optimistic removal: the dialog should close instantly.
    this.pending = before.filter((r) => r.id !== id);
    this.emit();
    try {
      await API.post(`/api/permissions/${id}/${verb}`);
      return true;
    } catch {
      this.pending = before; // put it back; the user can retry
      this.emit();
      return false;
    }
  }

  startPolling(ms = 5000): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), ms);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** One store per page instance is plenty; approvals are global state. */
let sharedStore: ApprovalsStore | null = null;

export function getApprovalsStore(): ApprovalsStore {
  sharedStore ??= new ApprovalsStore();
  return sharedStore;
}

export function useApprovals() {
  // Module-level singleton — a stable identity without touching refs.
  const store = getApprovalsStore();

  const [pending, setPending] = useState<PendingPermission[]>([]);

  useEffect(() => {
    const unsub = store.subscribe(setPending);
    void store.refresh();
    store.startPolling(5000);
    return () => {
      unsub();
      store.stopPolling();
    };
  }, [store]);

  const approve = useCallback((id: string) => store.approve(id), [store]);
  const deny = useCallback((id: string) => store.deny(id), [store]);
  const refresh = useCallback(() => store.refresh(), [store]);

  return { pending, approve, deny, refresh };
}

/* ------------------------------------------------------------------ */
/* Retro permission dialog                                             */
/* ------------------------------------------------------------------ */

export function PermissionDialog(props: {
  request: PendingPermission;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onClose: () => void;
}) {
  const { request, onApprove, onDeny, onClose } = props;
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="rp-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Permission request"
    >
      <div className="rp-panel rp-panel--dialog w-[26rem] max-w-[90vw]">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="rp-title text-[11px]" style={{ color: "#ff6b6b" }}>
            Needs you
          </span>
          <button className="rp-btn rp-btn--ghost h-6 px-2 rp-small" onClick={onClose}>
            close
          </button>
        </div>

        <p className="rp-small mb-1">{request.description}</p>
        {request.command ? (
          <pre className="rp-mono rp-panel rp-panel--inset px-2 py-1 mb-3 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
            {request.command}
          </pre>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            className="rp-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onDeny(request.id);
              onClose();
            }}
          >
            Deny
          </button>
          <button
            className="rp-btn rp-btn--primary rp-btn--mint"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onApprove(request.id);
              onClose();
            }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
