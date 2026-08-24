import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SegmentedControl,
  StatusDot,
} from "../components/ui";
import { API } from "../lib/api";
import { useProjects } from "../state/ProjectContext";
import { cn } from "../lib/cn";

interface Schedule {
  id: string;
  name: string;
  cron_expression: string | null;
  calendar_date: string | null;
  workflow_id: string | null;
  status: "active" | "paused";
  project_id: string | null;
  color: string | null;
  created_at: number;
  updated_at: number;
  nextRuns: number[];
  cronSummary: string | null;
}

interface ScheduleRun {
  id: string;
  scheduleId: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
}

const PALETTE = [
  "#e8a33d",
  "#4fa97c",
  "#5b8dd9",
  "#d9584c",
  "#8b8ef0",
  "#35c9a6",
  "#d98cc4",
  "#c2894a",
];

export function SchedulePage() {
  const { activeProject, activeProjectId } = useProjects();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => new Date());
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setSchedules([]);
      setLoading(false);
      return;
    }
    try {
      const data = await API.get<{ schedules: Schedule[] }>(
        `/api/schedules?projectId=${encodeURIComponent(activeProjectId)}`,
      );
      setSchedules(data.schedules);
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRuns([]);
      return;
    }
    API.get<{ runs: ScheduleRun[] }>(`/api/schedules/${selectedId}/runs`)
      .then((d) => setRuns(d.runs))
      .catch(() => setRuns([]));
  }, [selectedId, schedules]);

  const toggle = async (s: Schedule) => {
    await API.put(`/api/schedules/${s.id}`, {
      status: s.status === "active" ? "paused" : "active",
    });
    await load();
  };

  const runNow = async (s: Schedule) => {
    await API.post(`/api/schedules/${s.id}/run`);
    setSelectedId(s.id);
    await load();
  };

  const remove = async (s: Schedule) => {
    await API.del(`/api/schedules/${s.id}`);
    if (selectedId === s.id) setSelectedId(null);
    await load();
  };

  if (!activeProject) {
    return (
      <div className="p-6 h-full flex flex-col">
        <PageHeader eyebrow="Direct" title="Schedule" />
        <EmptyState
          icon={<FolderGit2 />}
          title="No project selected"
          description="Pick a project from the switcher above to schedule work for it."
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        eyebrow="Direct"
        title="Schedule"
        description="Work the swarm picks up on its own, on a repeating schedule."
        actions={
          <div className="flex items-center gap-2">
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: "List" },
                { value: "calendar", label: "Calendar" },
              ]}
            />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New schedule
            </Button>
          </div>
        }
      />

      {loading ? (
        <p className="text-[13px] text-muted">Loading schedules…</p>
      ) : schedules.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Calendar />}
            title="Nothing scheduled"
            description="Set up a recurring task and Hive will run it without you asking."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                New schedule
              </Button>
            }
            className="py-12"
          />
        </Card>
      ) : view === "calendar" ? (
        <CalendarView
          schedules={schedules}
          month={month}
          onMonthChange={setMonth}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4">
          <div className="flex flex-col gap-2.5">
            {schedules.map((s) => (
              <Card
                key={s.id}
                className={cn(
                  "relative overflow-hidden p-3.5 pl-4 cursor-pointer transition-colors",
                  selectedId === s.id ? "border-line-strong" : "hover:border-line-strong",
                  s.status === "paused" && "opacity-60",
                )}
                onClick={() => setSelectedId(s.id)}
              >
                <span
                  className="absolute left-0 top-0 bottom-0 w-1"
                  style={{ background: s.color ?? "var(--hive-accent)" }}
                />
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-medium text-ink truncate">
                        {s.name}
                      </h3>
                      <Badge tone={s.status === "active" ? "ok" : "neutral"}>
                        {s.status}
                      </Badge>
                    </div>
                    <p className="text-[12px] text-muted mt-0.5">
                      {s.cronSummary ?? "No schedule set"}
                      <span className="font-mono text-faint ml-2">
                        {s.cron_expression}
                      </span>
                    </p>
                    {s.nextRuns.length > 0 && s.status === "active" ? (
                      <p className="text-[11px] text-faint mt-1.5">
                        Next: {formatWhen(s.nextRuns[0])}
                      </p>
                    ) : null}
                  </div>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconButton
                      size="sm"
                      onClick={() => void runNow(s)}
                      aria-label={`Run ${s.name} now`}
                      title="Run now"
                    >
                      <Play className="size-3.5" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      onClick={() => void toggle(s)}
                      aria-label={
                        s.status === "active" ? `Pause ${s.name}` : `Resume ${s.name}`
                      }
                    >
                      {s.status === "active" ? (
                        <Pause className="size-3.5" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="danger"
                      onClick={() => void remove(s)}
                      aria-label={`Delete ${s.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card className="self-start">
            <CardHeader eyebrow="History" title="Recent runs" />
            {!selectedId ? (
              <p className="px-4 py-5 text-[13px] text-muted">
                Select a schedule to see when it last ran.
              </p>
            ) : runs.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-muted">
                This schedule hasn't run yet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <StatusDot tone={r.status === "success" ? "ok" : "danger"} />
                    <span className="text-[12px] text-ink flex-1">{r.status}</span>
                    <span className="font-mono text-[11px] text-faint" data-numeric>
                      {formatWhen(r.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <ScheduleForm
        open={creating || !!editing}
        schedule={editing}
        projectId={activeProjectId}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void load();
        }}
      />
    </div>
  );
}

function CalendarView({
  schedules,
  month,
  onMonthChange,
}: {
  schedules: Schedule[];
  month: Date;
  onMonthChange: (d: Date) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const startPad = first.getDay();
  const today = new Date();

  // Which schedules fire on each day of this month.
  const byDay = useMemo(() => {
    // Derived inside so the memo depends only on its real inputs.
    const y = month.getFullYear();
    const mo = month.getMonth();
    const map = new Map<number, Schedule[]>();
    for (const s of schedules) {
      if (s.status !== "active") continue;
      for (const t of s.nextRuns) {
        const d = new Date(t);
        if (d.getFullYear() !== y || d.getMonth() !== mo) continue;
        const list = map.get(d.getDate()) ?? [];
        if (!list.some((x) => x.id === s.id)) list.push(s);
        map.set(d.getDate(), list);
      }
    }
    return map;
  }, [schedules, month]);

  return (
    <Card>
      <CardHeader
        eyebrow="Upcoming"
        title={month.toLocaleString("default", { month: "long", year: "numeric" })}
        actions={
          <div className="flex items-center gap-1">
            <IconButton
              size="sm"
              onClick={() => onMonthChange(new Date(year, m - 1, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-3.5" />
            </IconButton>
            <IconButton
              size="sm"
              onClick={() => onMonthChange(new Date(year, m + 1, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="size-3.5" />
            </IconButton>
          </div>
        }
      />
      <div className="grid grid-cols-7 border-b border-line">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="eyebrow px-2 py-1.5 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: startPad }).map((_, i) => (
          <div key={`pad-${i}`} className="min-h-24 border-r border-b border-line" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const isToday =
            today.getFullYear() === year &&
            today.getMonth() === m &&
            today.getDate() === day;
          const items = byDay.get(day) ?? [];
          return (
            <div
              key={day}
              className="min-h-24 border-r border-b border-line p-1.5 flex flex-col gap-1"
            >
              <span
                className={cn(
                  "font-mono text-[11px] self-start px-1 rounded-sm",
                  isToday ? "bg-accent text-accent-fg" : "text-faint",
                )}
                data-numeric
              >
                {day}
              </span>
              {items.map((s) => (
                <span
                  key={s.id}
                  className="flex items-center gap-1 text-[10px] text-ink truncate"
                  title={`${s.name} — ${s.cronSummary ?? ""}`}
                >
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ background: s.color ?? "var(--hive-accent)" }}
                  />
                  <span className="truncate">{s.name}</span>
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ScheduleForm({
  open,
  schedule,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean;
  schedule: Schedule | null;
  projectId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [color, setColor] = useState(PALETTE[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(schedule?.name ?? "");
    setCron(schedule?.cron_expression ?? "0 9 * * 1-5");
    setColor(schedule?.color ?? PALETTE[0]);
    setError(null);
  }, [open, schedule]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name,
        cron_expression: cron,
        color,
        project_id: projectId,
      };
      if (schedule) await API.put(`/api/schedules/${schedule.id}`, body);
      else await API.post("/api/schedules", body);
      onSaved();
    } catch (err) {
      // The server validates the cron expression and explains what's wrong.
      setError(err instanceof Error ? err.message : "Could not save the schedule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={schedule ? "Edit schedule" : "New schedule"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name || saving}>
            {saving ? "Saving…" : schedule ? "Save changes" : "Create schedule"}
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
              placeholder="Nightly test sweep"
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
        <div>
          <span className="text-[12px] font-medium text-ink">Colour</span>
          <div className="flex gap-1.5 mt-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Use colour ${c}`}
                className={cn(
                  "size-6 rounded-md border-2 transition-transform",
                  color === c ? "border-ink scale-110" : "border-transparent",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString()} ${time}`;
}
