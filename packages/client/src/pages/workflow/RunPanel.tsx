import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Play, Square, X } from "lucide-react";
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  StatusDot,
} from "../../components/ui";
import { subscribeToEvents } from "../../lib/api";
import { cn } from "../../lib/cn";
import { nodeDef } from "./nodeDefs";
import {
  approveRunStep,
  cancelRun,
  denyRunStep,
  getRun,
  listRuns,
  type WorkflowRunRecord,
  type WorkflowRunStatus,
  type WorkflowRunStepRecord,
} from "./runsApi";

/** "90s", "3m", "1h12m" — elapsed clocks, not timestamps. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 > 0 ? `${m % 60}m` : ""}`;
}

type Tone = "neutral" | "accent" | "ok" | "danger";

/** Step/run status → StatusDot tone, one mapping for panel + canvas. */
export function statusTone(status: string): Tone {
  switch (status) {
    case "success":
      return "ok";
    case "failed":
    case "cancelled":
      return "danger";
    case "running":
    case "waiting_approval":
      return "accent";
    default:
      return "neutral";
  }
}

function isLive(status: WorkflowRunStatus): boolean {
  return status === "running" || status === "waiting_approval" || status === "queued";
}

/**
 * Live run monitor: step list, output viewer, approve/deny, cancel, history.
 * Polls while live AND applies SSE step events so the list moves in real
 * time even between polls. Pure display — the server owns run state.
 */
export function RunPanel({
  workflowId,
  runId,
  onClose,
  onRunningChange,
}: {
  workflowId: string;
  runId: string | null;
  onClose: () => void;
  onRunningChange?: (running: boolean) => void;
}) {
  const [run, setRun] = useState<WorkflowRunRecord | null>(null);
  const [history, setHistory] = useState<WorkflowRunRecord[]>([]);
  const [tab, setTab] = useState<"steps" | "runs">("steps");
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!runId) {
      setRun(null);
      return;
    }
    try {
      setRun(await getRun(runId));
    } catch {
      // A deleted run reads as gone; keep the last known state.
    }
  }, [runId]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listRuns(workflowId));
    } catch {
      setHistory([]);
    }
  }, [workflowId]);

  useEffect(() => {
    // Resets per-run UI state when switching runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedStep(null);
    setActionError(null);
    setConfirmCancel(false);
    void refresh();
    void refreshHistory();
  }, [runId, refresh, refreshHistory]);

  useEffect(() => {
    if (!run || !isLive(run.status)) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [run?.status, refresh, run]);

  useEffect(() => {
    if (!runId) return;
    return subscribeToEvents((type: string, data: unknown) => {
      if (
        type !== "workflow:run:step" &&
        type !== "workflow:run:finished" &&
        type !== "workflow:run:approval"
      ) {
        return;
      }
      const d = data as { runId?: string } | null;
      if (!d || d.runId !== runId) return;
      void refresh();
      void refreshHistory();
    });
  }, [runId, refresh, refreshHistory]);

  useEffect(() => {
    onRunningChange?.(!!run && isLive(run.status));
  }, [run?.status, onRunningChange, run]);

  const steps = useMemo(() => run?.steps ?? [], [run]);
  const waitingStep = useMemo(
    () => steps.find((s) => s.status === "waiting_approval") ?? null,
    [steps],
  );
  const activeStep = useMemo(
    () => steps.find((s) => s.id === selectedStep) ?? steps[steps.length - 1] ?? null,
    [steps, selectedStep],
  );

  async function act(label: string, fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      await refresh();
      await refreshHistory();
    } catch (err) {
      setActionError(
        err instanceof Error ? `${label} failed: ${err.message}` : `${label} failed.`,
      );
    }
  }

  if (!runId) return null;

  const elapsed = run
    ? formatElapsed((run.finished_at ?? now) - run.started_at)
    : "—";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
        <div className="min-w-0">
          <div className="eyebrow">Run</div>
          <div className="flex items-center gap-2 mt-0.5">
            {run ? (
              <StatusDot tone={statusTone(run.status)} pulse={isLive(run.status)} />
            ) : null}
            <span className="text-sm font-semibold text-ink">
              {run ? run.status.replace("_", " ") : "Loading…"}
            </span>
            <span className="font-mono text-[11px] text-faint" data-numeric>
              {elapsed}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {run && isLive(run.status) ? (
            confirmCancel ? (
              <>
                <Button size="sm" variant="danger" onClick={() => void act("Cancel", () => cancelRun(run.id))}>
                  Confirm
                </Button>
                <Button size="sm" onClick={() => setConfirmCancel(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmCancel(true)}>
                <Square className="size-3.5" />
                Cancel
              </Button>
            )
          ) : null}
          <IconButton size="sm" onClick={onClose} aria-label="Close run panel">
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="flex items-center gap-1 px-4 pt-2.5">
        {(["steps", "runs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "h-7 px-2.5 rounded-md text-xs transition-colors",
              tab === t
                ? "bg-surface-2 text-ink font-medium"
                : "text-muted hover:text-ink",
            )}
          >
            {t === "steps" ? "Steps" : `Runs (${history.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 pt-2.5 flex flex-col gap-3 min-h-0">
        {tab === "runs" ? (
          <RunHistory
            history={history}
            currentId={runId}
            onPick={(id) => {
              setTab("steps");
              setSelectedStep(null);
              void getRun(id).then(setRun).catch(() => {});
            }}
          />
        ) : (
          <>
            {waitingStep ? (
              <ApprovalCard
                step={waitingStep}
                note={note}
                onNote={setNote}
                onApprove={() =>
                  void act("Approve", () => approveRunStep(waitingStep.run_id, waitingStep.node_id, note || undefined))
                }
                onDeny={() =>
                  void act("Deny", () => denyRunStep(waitingStep.run_id, waitingStep.node_id, note || undefined))
                }
              />
            ) : null}
            {steps.length === 0 ? (
              <p className="text-[13px] text-muted">
                {run ? "No steps yet — the run is starting." : "Loading run…"}
              </p>
            ) : (
              <ol className="flex flex-col gap-1">
                {steps.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedStep(s.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-colors",
                        s.id === activeStep?.id
                          ? "border-line-strong bg-surface-2"
                          : "border-transparent hover:bg-surface-2",
                      )}
                    >
                      <StatusDot tone={statusTone(s.status)} pulse={s.status === "running"} />
                      <StepLabel step={s} />
                      <StepDuration step={s} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {activeStep ? <StepDetail step={activeStep} /> : null}
            {actionError ? (
              <p className="text-[12px] text-danger" role="alert">
                {actionError}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function StepLabel({ step }: { step: WorkflowRunStepRecord }) {
  let label = step.node_type;
  let Icon: React.ComponentType<{ className?: string }> | null = null;
  try {
    const def = nodeDef(step.node_type as never);
    label = def.label;
    Icon = def.icon;
  } catch {
    // Unknown kind from a newer server: text-only row.
  }
  return (
    <span className="min-w-0 flex-1 flex items-center gap-1.5">
      {Icon ? <Icon className="size-3.5 text-muted shrink-0" aria-hidden="true" /> : null}
      <span className="text-[12.5px] text-ink truncate">{label}</span>
      <Badge tone={step.status === "success" ? "ok" : step.status === "failed" ? "danger" : "neutral"}>
        {step.status.replace("_", " ")}
      </Badge>
    </span>
  );
}

function StepDuration({ step }: { step: WorkflowRunStepRecord }) {
  if (!step.finished_at) return null;
  return (
    <span className="font-mono text-[10px] text-faint shrink-0" data-numeric>
      {formatElapsed(step.finished_at - step.started_at)}
    </span>
  );
}

function StepDetail({ step }: { step: WorkflowRunStepRecord }) {
  const body = step.error || step.output;
  if (!body) {
    return <p className="text-[12px] text-muted">No output yet.</p>;
  }
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-surface-2 border-b border-line eyebrow">
        {step.error ? "Error" : "Output"}
      </div>
      <pre className="px-3 py-2 font-mono text-[11px] text-ink whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
        {body.slice(0, 4000)}
      </pre>
    </div>
  );
}

function ApprovalCard({
  step,
  note,
  onNote,
  onApprove,
  onDeny,
}: {
  step: WorkflowRunStepRecord;
  note: string;
  onNote: (v: string) => void;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="border border-accent-line bg-accent-soft rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Play className="size-3.5 text-accent" />
        Approval needed — {step.node_id}
      </div>
      <Field label="Note (optional)">
        {(id) => (
          <Input
            id={id}
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="Looks good"
          />
        )}
      </Field>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={onApprove}>
          <Check className="size-3.5" />
          Approve
        </Button>
        <Button size="sm" variant="danger" onClick={onDeny}>
          Deny
        </Button>
      </div>
    </div>
  );
}

function RunHistory({
  history,
  currentId,
  onPick,
}: {
  history: WorkflowRunRecord[];
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  if (history.length === 0) {
    return <p className="text-[13px] text-muted">No runs yet for this workflow.</p>;
  }
  return (
    <ol className="flex flex-col gap-1">
      {history.map((r) => (
        <li key={r.id}>
          <button
            onClick={() => onPick(r.id)}
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-colors",
              r.id === currentId
                ? "border-line-strong bg-surface-2"
                : "border-transparent hover:bg-surface-2",
            )}
          >
            <StatusDot tone={statusTone(r.status)} />
            <span className="text-[12.5px] text-ink capitalize flex-1">
              {r.status.replace("_", " ")}
            </span>
            <span className="font-mono text-[10px] text-faint" data-numeric>
              {new Date(r.started_at).toLocaleString()}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
