import { useEffect, useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import {
  Button,
  Field,
  Input,
  Modal,
  Switch,
} from "../../components/ui";
import { API } from "../../lib/api";
import { cn } from "../../lib/cn";

export interface WorkflowSchedule {
  id: string;
  name: string;
  cron_expression: string | null;
  workflow_id: string | null;
  status: "active" | "paused";
  color: string | null;
  nextRuns: number[];
  cronSummary: string | null;
}

export interface ScheduleBody {
  name: string;
  cron_expression: string;
  status: "active" | "paused";
  project_id: string | null;
  workflow_id: string;
}

/** Pure body builder so the modal's submit shape is unit-testable. */
export function buildScheduleBody(input: {
  name: string;
  cron: string;
  active: boolean;
  projectId: string | null;
  workflowId: string;
}): ScheduleBody {
  return {
    name: input.name.trim(),
    cron_expression: input.cron.trim(),
    status: input.active ? "active" : "paused",
    project_id: input.projectId,
    workflow_id: input.workflowId,
  };
}

export function validateScheduleInput(name: string, cron: string): string | null {
  if (!name.trim()) return "Give the schedule a name.";
  if (!cron.trim()) return "Enter a cron expression.";
  return null;
}

/**
 * Bind a cron schedule to one workflow. Creates, edits, pauses, and deletes
 * through /api/schedules; the server previews next runs + plain-English
 * summary so the client never parses cron.
 */
export function ScheduleModal({
  open,
  workflowId,
  workflowName,
  projectId,
  existing,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  workflowId: string;
  workflowName: string;
  projectId: string | null;
  existing: WorkflowSchedule | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [active, setActive] = useState(true);
  const [preview, setPreview] = useState<{
    nextRuns: number[];
    cronSummary: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(existing?.name ?? `${workflowName} schedule`);
    setCron(existing?.cron_expression ?? "0 9 * * 1-5");
    setActive((existing?.status ?? "active") === "active");
    setPreview(null);
    setError(null);
  }, [open, existing, workflowName]);

  useEffect(() => {
    if (!open || !cron.trim()) return;
    const timer = setTimeout(() => {
      API.get<{ nextRuns: number[]; cronSummary: string }>(
        `/api/schedules/preview?cron=${encodeURIComponent(cron)}`,
      )
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [open, cron]);

  async function save() {
    const problem = validateScheduleInput(name, cron);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = buildScheduleBody({
        name,
        cron,
        active,
        projectId,
        workflowId,
      });
      if (existing) await API.put(`/api/schedules/${existing.id}`, body);
      else await API.post("/api/schedules", body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      await API.del(`/api/schedules/${existing.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Edit schedule" : "Schedule workflow"}
      description={`Runs "${workflowName}" on its own.`}
      width="md"
      footer={
        <>
          {existing ? (
            <Button variant="danger" onClick={() => void remove()} disabled={saving} className="mr-auto">
              <Trash2 className="size-4" />
              Delete
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Create schedule"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${workflowName} nightly`}
              autoFocus
            />
          )}
        </Field>
        <Field
          label="Repeats"
          required
          hint="Cron expression — minute, hour, day of month, month, day of week."
          error={error}
        >
          {(id) => (
            <Input
              id={id}
              className="font-mono text-[12px]"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * 1-5"
            />
          )}
        </Field>
        {preview ? (
          <div className="border border-line rounded-lg px-3 py-2.5 bg-surface-2 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
              <CalendarClock className="size-3.5 text-accent" />
              {preview.cronSummary}
            </span>
            {preview.nextRuns.slice(0, 3).map((t) => (
              <span key={t} className="font-mono text-[11px] text-muted" data-numeric>
                {new Date(t).toLocaleString()}
              </span>
            ))}
          </div>
        ) : null}
        <div className={cn("flex items-center gap-3")}>
          <Switch
            checked={active}
            onChange={setActive}
            label={active ? "Active — fires on schedule" : "Paused"}
          />
        </div>
      </div>
    </Modal>
  );
}
