import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, Plus } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Select,
  StatusDot,
  Textarea,
} from "../components/ui";
import { API, subscribeToEvents } from "../lib/api";
import { useProjects } from "../state/ProjectContext";
import { cn } from "../lib/cn";
import {
  COLUMNS,
  HARNESSES,
  STATUS_TONE,
  harnessColorVar,
  harnessLabel,
} from "./kanban/constants";
import type { KanbanTask, TaskStatus } from "./kanban/types";
import { useStickyState } from "../lib/useStickyState";

export function KanbanPage() {
  const { activeProject, activeProjectId } = useProjects();
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [harnessFilter, setHarnessFilter] = useStickyState(
    "kanban.harnessFilter",
    "",
  );
  const [selected, setSelected] = useState<KanbanTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newHarness, setNewHarness] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    try {
      const data = await API.get<{ tasks: KanbanTask[] }>(
        `/api/tasks?projectId=${encodeURIComponent(activeProjectId)}`,
      );
      setTasks(data.tasks);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void load();
    const unsubscribe = subscribeToEvents(() => void load());
    return unsubscribe;
  }, [load]);

  const visible = useMemo(
    () => (harnessFilter ? tasks.filter((t) => t.harness === harnessFilter) : tasks),
    [tasks, harnessFilter],
  );

  const move = useCallback(
    async (task: KanbanTask, status: TaskStatus) => {
      if (task.status === status) return;
      // Optimistic: the board should feel immediate, and load() reconciles.
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status } : t)),
      );
      if (liveRef.current) {
        liveRef.current.textContent = `Moved to ${status.replace("_", " ")}`;
      }
      try {
        await API.put(`/api/tasks/${task.id}`, { status });
      } finally {
        await load();
      }
    },
    [load],
  );

  async function create() {
    if (!activeProjectId || !newPrompt.trim()) return;
    await API.post("/api/tasks", {
      projectId: activeProjectId,
      prompt: newPrompt.trim(),
      harness: newHarness || null,
    });
    setNewPrompt("");
    setNewHarness("");
    setCreating(false);
    await load();
  }

  if (!activeProject) {
    return (
      <div className="p-6 h-full flex flex-col">
        <PageHeader eyebrow="Direct" title="Kanban" />
        <EmptyState
          icon={<FolderGit2 />}
          title="No project selected"
          description="Pick a project from the switcher above to see its board."
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Direct"
          title="Kanban"
          description="Work queued for the swarm in this project, and where each task got to."
          actions={
            <div className="flex items-center gap-2">
              <Select
                value={harnessFilter}
                onChange={(e) => setHarnessFilter(e.target.value)}
                className="w-40"
                aria-label="Filter by harness"
              >
                <option value="">All harnesses</option>
                {HARNESSES.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </Select>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                New task
              </Button>
            </div>
          }
        />
      </div>

      <p ref={liveRef} className="sr-only" aria-live="polite" />

      <div className="flex-1 min-h-0 border-t border-line overflow-x-auto">
        <div className="h-full flex gap-3 p-4 min-w-max">
          {COLUMNS.map((col) => {
            const items = visible.filter((t) => t.status === col.id);
            const over = col.wipLimit !== undefined && items.length > col.wipLimit;

            return (
              <section
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(col.id);
                }}
                onDragLeave={() => setDragOver((c) => (c === col.id ? null : c))}
                onDrop={() => {
                  const task = tasks.find((t) => t.id === dragging);
                  if (task) void move(task, col.id);
                  setDragging(null);
                  setDragOver(null);
                }}
                className={cn(
                  "w-72 shrink-0 flex flex-col rounded-lg border bg-surface transition-colors",
                  dragOver === col.id
                    ? "border-accent bg-accent-soft"
                    : "border-line",
                )}
              >
                <header className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
                  <StatusDot tone={STATUS_TONE[col.id]} />
                  <h2 className="text-[13px] font-medium text-ink">{col.title}</h2>
                  <span
                    className={cn(
                      "font-mono text-[11px] ml-auto",
                      over ? "text-warn" : "text-faint",
                    )}
                    data-numeric
                  >
                    {items.length}
                    {col.wipLimit !== undefined ? ` / ${col.wipLimit}` : ""}
                  </span>
                </header>

                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                  {loading ? (
                    <p className="px-1 py-2 text-[12px] text-muted">Loading…</p>
                  ) : items.length === 0 ? (
                    <p className="px-1 py-2 text-[12px] text-faint">Nothing here.</p>
                  ) : (
                    items.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        dragging={dragging === task.id}
                        onDragStart={() => setDragging(task.id)}
                        onDragEnd={() => setDragging(null)}
                        onOpen={() => setSelected(task)}
                        onMove={(s) => void move(task, s)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <TaskDetail task={selected} onClose={() => setSelected(null)} />

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New task"
        description={`Queued in ${activeProject.name}.`}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void create()} disabled={!newPrompt.trim()}>
              Add task
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="What should the agent do?" required>
            {(id) => (
              <Textarea
                id={id}
                rows={4}
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="Add tests for the router's keyword matching"
                autoFocus
              />
            )}
          </Field>
          <Field label="Harness" hint="Leave on automatic to let routing decide.">
            {(id) => (
              <Select
                id={id}
                value={newHarness}
                onChange={(e) => setNewHarness(e.target.value)}
              >
                <option value="">Choose automatically</option>
                {HARNESSES.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function TaskCard({
  task,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onMove,
}: {
  task: KanbanTask;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onMove: (status: TaskStatus) => void;
}) {
  const duration =
    task.started_at && task.completed_at
      ? formatDuration(task.completed_at - task.started_at)
      : null;

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group rounded-md border bg-surface-2 p-2.5 cursor-grab active:cursor-grabbing transition-all",
        dragging
          ? "opacity-40 border-accent"
          : "border-line hover:border-line-strong",
      )}
    >
      <button onClick={onOpen} className="w-full text-left">
        <p className="text-[13px] text-ink line-clamp-3">{task.prompt}</p>
      </button>

      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
        <span
          className="inline-flex items-center gap-1 font-mono text-[10px] text-muted"
          title={harnessLabel(task.harness)}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: `var(${harnessColorVar(task.harness)})` }}
          />
          {harnessLabel(task.harness)}
        </span>
        {task.iterations > 0 ? (
          <span className="font-mono text-[10px] text-faint" data-numeric>
            {task.iterations}× iter
          </span>
        ) : null}
        {task.files_changed > 0 ? (
          <span className="font-mono text-[10px] text-faint" data-numeric>
            {task.files_changed} files
          </span>
        ) : null}
        {duration ? (
          <span className="font-mono text-[10px] text-faint" data-numeric>
            {duration}
          </span>
        ) : null}
      </div>

        {/* Keyboard/no-drag path — drag shouldn't be the only way to move
            a card. Always rendered so it never shifts the card's height. */}
        <Select
          value={task.status}
          onChange={(e) => onMove(e.target.value as TaskStatus)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Move task to another column"
          className="h-6 w-[7.5rem] text-[11px] ml-auto border-transparent bg-transparent text-faint hover:border-line hover:text-muted"
        >
          {COLUMNS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
    </article>
  );
}

function TaskDetail({
  task,
  onClose,
}: {
  task: KanbanTask | null;
  onClose: () => void;
}) {
  if (!task) return null;
  return (
    <Modal open onClose={onClose} title="Task" width="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={STATUS_TONE[task.status]}>{task.status.replace("_", " ")}</Badge>
          <Badge>{harnessLabel(task.harness)}</Badge>
          {task.branch_name ? (
            <span className="font-mono text-[11px] text-muted">{task.branch_name}</span>
          ) : null}
        </div>

        <div>
          <div className="eyebrow mb-1.5">Prompt</div>
          <p className="text-[13px] text-ink whitespace-pre-wrap">{task.prompt}</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Metric label="Iterations" value={task.iterations} />
          <Metric label="Files changed" value={task.files_changed} />
          <Metric
            label="Duration"
            value={
              task.started_at && task.completed_at
                ? formatDuration(task.completed_at - task.started_at)
                : "—"
            }
          />
        </div>

        {task.error ? (
          <div>
            <div className="eyebrow mb-1.5">Error</div>
            <pre className="font-mono text-[11px] text-danger bg-danger-soft border border-danger rounded-md p-2.5 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {task.error}
            </pre>
          </div>
        ) : null}

        {task.output ? (
          <div>
            <div className="eyebrow mb-1.5">Output</div>
            <pre className="font-mono text-[11px] text-muted bg-surface-2 border border-line rounded-md p-2.5 whitespace-pre-wrap max-h-56 overflow-y-auto">
              {task.output}
            </pre>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="eyebrow mb-1">{label}</div>
      <div className="text-[15px] text-ink" data-numeric>
        {value}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
