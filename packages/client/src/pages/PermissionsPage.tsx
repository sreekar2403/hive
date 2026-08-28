import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Shield, ShieldAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  StatusDot,
} from "../components/ui";
import { API, subscribeToEvents } from "../lib/api";
import { cn } from "../lib/cn";

interface PermissionRequest {
  id: string;
  sessionId: string;
  action: string;
  description: string;
  command?: string;
  files?: string[];
  timestamp: number;
  approved: boolean | null;
  timeoutAt: number;
  denyReason?: string;
}

type Decision = {
  id: string;
  action: string;
  sessionId: string;
  outcome: "approved" | "denied" | "timed out";
  at: number;
  reason?: string;
};

const HISTORY_KEY = "hive.permissionHistory";

export function PermissionsPage() {
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [history, setHistory] = useState<Decision[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(HISTORY_KEY) ?? "[]",
      ) as Decision[];
    } catch {
      return [];
    }
  });
  const [rules, setRules] = useState<string[]>([]);
  const [denying, setDenying] = useState<PermissionRequest | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const record = useCallback((entry: Decision) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 50);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // History is a convenience; losing it is acceptable.
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      setPending(await API.get<PermissionRequest[]>("/api/permissions"));
    } catch {
      setPending([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const unsubscribe = subscribeToEvents(() => void load());
    const poll = setInterval(() => void load(), 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsubscribe();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  // The configured trigger words, shown read-only for context.
  useEffect(() => {
    API.get<{ permission: { destructiveActions: string[] } }>("/api/settings")
      .then((s) => setRules(s.permission.destructiveActions))
      .catch(() => setRules([]));
  }, []);

  const decide = useCallback(
    async (request: PermissionRequest, approve: boolean, reason?: string) => {
      try {
        await API.post(
          `/api/permissions/${request.id}/${approve ? "approve" : "deny"}`,
          approve ? undefined : { reason },
        );
        record({
          id: request.id,
          action: request.action,
          sessionId: request.sessionId,
          outcome: approve ? "approved" : "denied",
          at: Date.now(),
          reason,
        });
      } finally {
        setDenying(null);
        setDenyReason("");
        await load();
      }
    },
    [load, record],
  );

  return (
    <div className="p-6">
      <PageHeader
        eyebrow="Inspect"
        title="Permissions"
        description="Hive pauses an agent before destructive work and waits for your call."
        actions={
          pending.length > 0 ? (
            <Badge tone="warn">{pending.length} waiting</Badge>
          ) : null
        }
      />

      <div className="flex flex-col gap-4 max-w-4xl">
        {pending.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Shield />}
              title="No approvals waiting"
              description="When a task mentions something destructive, it stops here until you approve or deny it."
              className="py-10"
            />
          </Card>
        ) : (
          pending.map((request) => {
            const remaining = Math.max(0, request.timeoutAt - now);
            const expired = remaining === 0;
            const total = Math.max(1, request.timeoutAt - request.timestamp);
            const pct = (remaining / total) * 100;

            return (
              <Card key={request.id} className="border-warn/60 overflow-hidden">
                <CardHeader
                  eyebrow={request.sessionId}
                  title={
                    <span className="flex items-center gap-2">
                      <ShieldAlert className="size-4 text-warn" />
                      Approval needed
                    </span>
                  }
                  actions={
                    <span
                      className={cn(
                        "font-mono text-[12px]",
                        expired ? "text-danger" : "text-warn",
                      )}
                      data-numeric
                    >
                      {expired
                        ? "Timed out"
                        : `${Math.ceil(remaining / 1000)}s left`}
                    </span>
                  }
                />

                <div className="h-0.5 bg-surface-2">
                  <div
                    className={cn(
                      "h-full transition-[width] duration-1000 ease-linear",
                      expired ? "bg-danger" : "bg-warn",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="p-4 flex flex-col gap-3">
                  <div>
                    <div className="eyebrow mb-1">Task</div>
                    <p className="text-[13px] text-ink">
                      {request.description}
                    </p>
                  </div>

                  {matchedWords(request.description, rules).length > 0 ? (
                    <div>
                      <div className="eyebrow mb-1.5">Why it stopped</div>
                      <div className="flex flex-wrap gap-1.5">
                        {matchedWords(request.description, rules).map((w) => (
                          <Badge key={w} tone="warn">
                            {w}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {request.files?.length ? (
                    <div>
                      <div className="eyebrow mb-1.5">Files</div>
                      <ul className="font-mono text-[11px] text-muted flex flex-col gap-0.5">
                        {request.files.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="primary"
                      onClick={() => void decide(request, true)}
                      disabled={expired}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setDenying(request)}
                      disabled={expired}
                    >
                      Deny
                    </Button>
                    {expired ? (
                      <span className="text-[12px] text-muted">
                        Nobody answered in time, so the task was denied.
                      </span>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })
        )}

        <Card>
          <CardHeader eyebrow="Audit" title="Recent decisions" />
          {history.length === 0 ? (
            <p className="px-4 py-5 text-[13px] text-muted">
              Decisions you make will be listed here.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((d) => (
                <li
                  key={`${d.id}-${d.at}`}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <StatusDot
                    tone={d.outcome === "approved" ? "ok" : "danger"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink truncate">
                      {d.action}
                    </span>
                    <span className="block font-mono text-[10px] text-faint truncate">
                      {d.sessionId}
                      {d.reason ? ` · ${d.reason}` : ""}
                    </span>
                  </span>
                  <Badge tone={d.outcome === "approved" ? "ok" : "danger"}>
                    {d.outcome}
                  </Badge>
                  <span
                    className="text-[11px] text-faint whitespace-nowrap"
                    data-numeric
                  >
                    {relativeTime(d.at, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            eyebrow="Configured"
            title="Words that trigger approval"
            actions={
              <Link
                to="/settings"
                className="text-[12px] text-accent hover:underline"
              >
                Edit in Settings
              </Link>
            }
          />
          <div className="p-4 flex flex-wrap gap-1.5">
            {rules.length === 0 ? (
              <span className="text-[13px] text-muted">
                No trigger words configured — nothing will be gated.
              </span>
            ) : (
              rules.map((r) => (
                <span
                  key={r}
                  className="px-2 py-0.5 rounded-sm border border-line bg-surface-2 font-mono text-[11px] text-ink"
                >
                  {r}
                </span>
              ))
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={!!denying}
        onClose={() => setDenying(null)}
        title="Deny this task?"
        description="The agent stops and the task is marked failed."
        width="sm"
        footer={
          <>
            <Button onClick={() => setDenying(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() =>
                denying && void decide(denying, false, denyReason || undefined)
              }
            >
              Deny task
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="Optional. Recorded in the audit list.">
          {(id) => (
            <Input
              id={id}
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="Too risky on main"
              autoFocus
            />
          )}
        </Field>
      </Modal>
    </div>
  );
}

function matchedWords(text: string, rules: string[]): string[] {
  const lower = text.toLowerCase();
  return rules.filter((r) => lower.includes(r.toLowerCase()));
}

function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
