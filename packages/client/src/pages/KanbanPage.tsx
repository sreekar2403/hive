import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  GripVertical,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  StatusDot,
  Switch,
  Textarea,
} from "../components/ui";
import { API, subscribeToEvents } from "../lib/api";
import { useProjects } from "../state/ProjectContext";
import { useCapacity } from "../state/useCapacity";
import { Markdown } from "../components/Markdown";
import { cn } from "../lib/cn";
import {
  COLUMNS,
  COLUMNS_BY_ID,
  HARNESSES,
  STATUS_TONE,
  TERMINAL_STATUSES,
  harnessColorVar,
  harnessLabel,
} from "./kanban/constants";
import type { KanbanTask, TaskDetailPayload, TaskStatus } from "./kanban/types";
import { useStickyState } from "../lib/useStickyState";

type Density = "compact" | "comfortable";

/**
 * Column width is the whole responsiveness story on a board: the columns
 * themselves never wrap, so the only lever is how much horizontal room
 * each one asks for before the board starts scrolling.
 */
const COLUMN_WIDTH: Record<Density, string> = {
  compact: "w-[15rem]",
  comfortable: "w-[19rem]",
};

export function KanbanPage() {
  const { activeProject, activeProjectId } = useProjects();
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [harnessFilter, setHarnessFilter] = useStickyState(
    "kanban.harnessFilter",
    "",
  );
  const [query, setQuery] = useStickyState("kanban.query", "");
  const [density, setDensity] = useStickyState<Density>(
    "kanban.density",
    "comfortable",
  );
  const [showTerminal, setShowTerminal] = useStickyState(
    "kanban.showTerminal",
    true,
  );
  const [collapsed, setCollapsed] = useStickyState<TaskStatus[]>(
    "kanban.collapsed",
    COLUMNS.filter((c) => c.minorByDefault).map((c) => c.id),
  );

  const [selected, setSelected] = useState<KanbanTask | null>(null);
  const capacity = useCapacity();
  const [creatingIn, setCreatingIn] = useState<TaskStatus | null>(null);
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

  /*
    The board used to refetch every task on every event the server emits,
    including events for other projects and for things the board doesn't
    show — so a single chat run could refetch the whole board a dozen
    times, and each refetch replaced the array and re-rendered every card.
    Now an event only schedules one coalesced reload, and only when it is
    actually about this project.
  */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void load();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToEvents((_type, data) => {
      const projectId = (data as { projectId?: string } | undefined)?.projectId;
      if (projectId && projectId !== activeProjectId) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void load();
      }, 300);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [load, activeProjectId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (harnessFilter && t.harness !== harnessFilter) return false;
      if (!needle) return true;
      return (
        t.prompt.toLowerCase().includes(needle) ||
        (t.title ?? "").toLowerCase().includes(needle) ||
        (t.harness ?? "").toLowerCase().includes(needle) ||
        (t.branch_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [tasks, harnessFilter, query]);

  /**
   * Fan-out relationships, computed over every task rather than the
   * filtered set: a sub-agent can finish while its request is still
   * running, so parent and children routinely sit in different columns and
   * a child may be filtered out while its parent is on screen.
   */
  const fanout = useMemo(() => {
    const childCount = new Map<string, number>();
    const parentOf = new Map<string, KanbanTask>();
    const byId = new Map(tasks.map((t) => [t.id, t]));

    for (const task of tasks) {
      if (!task.parent_id) continue;
      childCount.set(task.parent_id, (childCount.get(task.parent_id) ?? 0) + 1);
      const parent = byId.get(task.parent_id);
      if (parent) parentOf.set(task.id, parent);
    }
    return { childCount, parentOf };
  }, [tasks]);

  const byStatus = useMemo(() => {
    const groups = new Map<TaskStatus, KanbanTask[]>(
      COLUMNS.map((c) => [c.id, [] as KanbanTask[]]),
    );
    for (const task of visible) groups.get(task.status)?.push(task);
    return groups;
  }, [visible]);

  // "In progress" is the one column whose limit is not a convention: it is
  // how many agents this machine will actually run at once, so it follows
  // the capacity setting rather than a number baked into the constants.
  const columns = useMemo(
    () =>
      COLUMNS.filter(
        (c) => showTerminal || !TERMINAL_STATUSES.includes(c.id),
      ).map((c) =>
        c.id === "in_progress" && capacity
          ? { ...c, wipLimit: capacity.effectiveAgents }
          : c,
      ),
    [showTerminal, capacity],
  );

  const announce = (message: string) => {
    if (liveRef.current) liveRef.current.textContent = message;
  };

  /*
    A move is applied locally, then confirmed with the row the server sends
    back. The old version awaited a full board reload before the card
    settled, which made every drag feel like it had to think about it — and
    quietly discarded the response it had already been given.
  */
  const move = useCallback(async (task: KanbanTask, status: TaskStatus) => {
    if (task.status === status) return;
    const previous = task;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status } : t)),
    );
    announce(
      `${task.prompt.slice(0, 40)} moved to ${COLUMNS_BY_ID[status].title}`,
    );
    try {
      const updated = await API.put<KanbanTask>(`/api/tasks/${task.id}`, {
        status,
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch {
      setTasks((prev) =>
        prev.map((t) => (t.id === previous.id ? previous : t)),
      );
      announce("That move could not be saved");
    }
  }, []);

  const remove = useCallback(
    async (task: KanbanTask) => {
      const previous = tasks;
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setSelected((current) => (current?.id === task.id ? null : current));
      try {
        await API.del(`/api/tasks/${task.id}`);
        announce("Task deleted");
      } catch {
        setTasks(previous);
        announce("That task could not be deleted");
      }
    },
    [tasks],
  );

  const create = useCallback(
    async (input: { prompt: string; harness: string; status: TaskStatus }) => {
      if (!activeProjectId) return;
      const created = await API.post<KanbanTask>("/api/tasks", {
        projectId: activeProjectId,
        prompt: input.prompt,
        harness: input.harness || null,
        status: input.status,
      });
      setTasks((prev) => [created, ...prev]);
    },
    [activeProjectId],
  );

  const toggleCollapsed = useCallback(
    (id: TaskStatus) => {
      setCollapsed((prev) =>
        prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
      );
    },
    [setCollapsed],
  );

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

  const filtering = Boolean(query.trim() || harnessFilter);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Direct"
          title="Kanban"
          description="Work queued for the swarm in this project, and where each task got to."
          actions={
            <Button variant="primary" onClick={() => setCreatingIn("queued")}>
              <Plus className="size-4" />
              New task
            </Button>
          }
        />
      </div>

      {/* Toolbar wraps rather than overflowing: on a narrow window the
          filters stack instead of pushing the board off screen. */}
      <div className="px-6 pb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-faint pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="pl-8 pr-8"
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

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

        <SegmentedControl<Density>
          value={density}
          onChange={setDensity}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Roomy" },
          ]}
        />

        {/* A span rather than a label: Switch renders a button, which a
            wrapping label would not forward clicks to anyway. */}
        <span className="flex items-center gap-2 text-[12px] text-muted">
          <Switch
            size="sm"
            checked={showTerminal}
            onChange={setShowTerminal}
            label="Show the Done and Failed columns"
          />
          Finished
        </span>

        <span className="ml-auto font-mono text-[11px] text-faint" data-numeric>
          {visible.length}
          {filtering ? ` of ${tasks.length}` : ""} task
          {visible.length === 1 ? "" : "s"}
        </span>
      </div>

      <p ref={liveRef} className="sr-only" aria-live="polite" />

      <div className="flex-1 min-h-0 border-t border-line overflow-x-auto">
        <div className="h-full flex gap-3 p-4 min-w-max">
          {columns.map((col) => {
            const items = byStatus.get(col.id) ?? [];
            const isCollapsed = collapsed.includes(col.id);
            const over =
              col.wipLimit !== undefined && items.length > col.wipLimit;

            if (isCollapsed) {
              return (
                <CollapsedColumn
                  key={col.id}
                  title={col.title}
                  count={items.length}
                  tone={STATUS_TONE[col.id]}
                  highlight={dragOver === col.id}
                  onExpand={() => toggleCollapsed(col.id)}
                  onDragOver={() => setDragOver(col.id)}
                  onDragLeave={() =>
                    setDragOver((c) => (c === col.id ? null : c))
                  }
                  onDrop={() => {
                    const task = tasks.find((t) => t.id === dragging);
                    if (task) void move(task, col.id);
                    setDragging(null);
                    setDragOver(null);
                  }}
                />
              );
            }

            return (
              <section
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(col.id);
                }}
                onDragLeave={() =>
                  setDragOver((c) => (c === col.id ? null : c))
                }
                onDrop={() => {
                  const task = tasks.find((t) => t.id === dragging);
                  if (task) void move(task, col.id);
                  setDragging(null);
                  setDragOver(null);
                }}
                className={cn(
                  "shrink-0 flex flex-col rounded-lg border bg-surface transition-colors",
                  COLUMN_WIDTH[density],
                  dragOver === col.id
                    ? "border-accent bg-accent-soft"
                    : "border-line",
                )}
              >
                <header className="px-3 pt-2.5 pb-2 border-b border-line">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={STATUS_TONE[col.id]} />
                    <h2 className="text-[13px] font-medium text-ink truncate">
                      {col.title}
                    </h2>
                    <span
                      className={cn(
                        "font-mono text-[11px] ml-auto shrink-0",
                        over ? "text-warn" : "text-faint",
                      )}
                      data-numeric
                      title={
                        col.wipLimit !== undefined
                          ? `${items.length} of a suggested ${col.wipLimit}`
                          : undefined
                      }
                    >
                      {items.length}
                      {col.wipLimit !== undefined ? ` / ${col.wipLimit}` : ""}
                    </span>
                    <IconButton
                      size="sm"
                      onClick={() => setCreatingIn(col.id)}
                      aria-label={`Add a task to ${col.title}`}
                      title={`Add a task to ${col.title}`}
                      className="-mr-1"
                    >
                      <Plus className="size-3.5" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      onClick={() => toggleCollapsed(col.id)}
                      aria-label={`Collapse ${col.title}`}
                      title={`Collapse ${col.title}`}
                      className="-mr-1.5"
                    >
                      <ChevronLeft className="size-3.5" />
                    </IconButton>
                  </div>
                  {density === "comfortable" ? (
                    <p className="text-[11px] text-faint mt-0.5 truncate">
                      {col.blurb}
                    </p>
                  ) : null}
                </header>

                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                  {loading ? (
                    <p className="px-1 py-2 text-[12px] text-muted">Loading…</p>
                  ) : items.length === 0 ? (
                    /* A visible target, so an empty column can still be
                       dropped onto rather than looking inert. */
                    <p
                      className={cn(
                        "rounded-md border border-dashed px-2 py-6 text-center text-[12px] transition-colors",
                        dragOver === col.id
                          ? "border-accent text-accent"
                          : "border-line text-faint",
                      )}
                    >
                      {dragOver === col.id
                        ? `Drop in ${col.title}`
                        : filtering
                          ? "Nothing matches here"
                          : "Nothing here"}
                    </p>
                  ) : (
                    items.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        agentCount={fanout.childCount.get(task.id) ?? 0}
                        parent={fanout.parentOf.get(task.id) ?? null}
                        density={density}
                        dragging={dragging === task.id}
                        onDragStart={() => setDragging(task.id)}
                        onDragEnd={() => setDragging(null)}
                        onOpen={() => setSelected(task)}
                        onMove={(s) => void move(task, s)}
                        onDelete={() => void remove(task)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <TaskDetail
        key={selected?.id ?? "none"}
        task={selected}
        onClose={() => setSelected(null)}
        onMove={(s) => selected && void move(selected, s)}
        onDelete={() => selected && void remove(selected)}
      />

      <CreateTaskModal
        column={creatingIn}
        projectName={activeProject.name}
        onClose={() => setCreatingIn(null)}
        onCreate={create}
      />
    </div>
  );
}

/**
 * A collapsed column keeps its drop target and its count — the point of
 * collapsing eight columns is to stop them competing for width, not to
 * take them out of the workflow.
 */
function CollapsedColumn({
  title,
  count,
  tone,
  highlight,
  onExpand,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  title: string;
  count: number;
  tone: "neutral" | "accent" | "ok" | "info" | "warn" | "danger";
  highlight: boolean;
  onExpand: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
}) {
  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "w-11 shrink-0 flex flex-col items-center gap-2 rounded-lg border bg-surface py-2.5 transition-colors",
        highlight ? "border-accent bg-accent-soft" : "border-line",
      )}
    >
      <StatusDot tone={tone} />
      <span className="font-mono text-[11px] text-faint" data-numeric>
        {count}
      </span>
      <button
        onClick={onExpand}
        title={`Expand ${title}`}
        aria-label={`Expand ${title}`}
        className="flex-1 flex items-end justify-center text-[12px] text-muted hover:text-ink transition-colors"
      >
        <span
          className="whitespace-nowrap"
          style={{ writingMode: "vertical-rl", rotate: "180deg" }}
        >
          {title}
        </span>
      </button>
      <ChevronRight className="size-3.5 text-faint" aria-hidden="true" />
    </section>
  );
}

function TaskCard({
  task,
  agentCount,
  parent,
  density,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onMove,
  onDelete,
}: {
  task: KanbanTask;
  /** Sub-agents this request was split into; 0 for an ordinary card. */
  agentCount: number;
  /** The request this card was split out of, when it is a sub-agent. */
  parent: KanbanTask | null;
  density: Density;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onMove: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  const duration =
    task.started_at && task.completed_at
      ? formatDuration(task.completed_at - task.started_at)
      : null;

  // A sub-agent's prompt is its full briefing — its own instruction, what
  // its siblings are doing, and the original request. Correct to run and
  // unreadable on a card, so the planner's label wins where there is one.
  const heading = task.title?.trim() || task.prompt;

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-md border bg-surface-2 transition-colors",
        density === "compact" ? "p-2" : "p-2.5",
        dragging
          ? "opacity-40 border-accent"
          : "border-line hover:border-line-strong",
        // Sub-agents cannot be nested under their request the way they are
        // in a tree: a finished agent sits in a different column from its
        // still-running parent. An inset rail carries the relationship
        // across columns instead, and the parent line below names it.
        parent ? "ml-2 border-l-2 border-l-accent/40" : null,
      )}
    >
      {parent ? (
        <p
          className="mb-1 truncate font-mono text-[10px] text-faint"
          title={`Split from: ${parent.title?.trim() || parent.prompt}`}
        >
          ↳ {parent.title?.trim() || parent.prompt}
        </p>
      ) : null}
      <div className="flex items-start gap-1.5">
        {/* The whole card is draggable — the grip is the affordance that
            says so, since nothing else about a card suggests it. */}
        <GripVertical
          className="size-3.5 mt-0.5 shrink-0 text-faint opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
          aria-hidden="true"
        />
        <button
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
          title={task.prompt}
        >
          <p
            className={cn(
              "text-[13px] text-ink",
              density === "compact" ? "line-clamp-2" : "line-clamp-3",
            )}
          >
            {heading}
          </p>
        </button>
        <IconButton
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label="Delete task"
          title="Delete task"
          className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger transition-opacity"
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {agentCount > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded-sm bg-accent-soft px-1 font-mono text-[10px] text-accent"
            title={`Split across ${agentCount} sub-agents, each on its own branch`}
            data-numeric
          >
            {agentCount} agents
          </span>
        ) : null}
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

      {/* Keyboard/no-drag path — drag shouldn't be the only way to move a
          card. Always rendered so it never shifts the card's height. */}
      <Select
        value={task.status}
        onChange={(e) => onMove(e.target.value as TaskStatus)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Move task to another column"
        className="h-6 mt-1.5 w-full text-[11px] border-transparent bg-transparent text-faint hover:border-line hover:text-muted"
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

function CreateTaskModal({
  column,
  projectName,
  onClose,
  onCreate,
}: {
  column: TaskStatus | null;
  projectName: string;
  onClose: () => void;
  onCreate: (input: {
    prompt: string;
    harness: string;
    status: TaskStatus;
  }) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [harness, setHarness] = useState("");
  const [status, setStatus] = useState<TaskStatus>("queued");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening from a column header should land the task in that column.
  useEffect(() => {
    if (column) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(column);
      setError(null);
    }
  }, [column]);

  if (!column) return null;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onCreate({ prompt: prompt.trim(), harness, status });
      setPrompt("");
      setHarness("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      description={`Queued in ${projectName}.`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!prompt.trim() || saving}
          >
            {saving ? "Adding…" : "Add task"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What should the agent do?" required error={error}>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Add tests for the router's keyword matching"
              autoFocus
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Harness"
            hint="Leave on automatic to let routing decide."
          >
            {(id) => (
              <Select
                id={id}
                value={harness}
                onChange={(e) => setHarness(e.target.value)}
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
          <Field label="Column" hint="Where it lands on the board.">
            {(id) => (
              <Select
                id={id}
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/*
 * The card's full record.
 *
 * A board card is the visible end of a run, so opening one shows the run:
 * what it was asked, where it went, which files it touched and the trace it
 * left. Everything past the header is fetched on open — a board of fifty
 * cards should not carry fifty span trees around with it.
 */
function TaskDetail({
  task,
  onClose,
  onMove,
  onDelete,
}: {
  task: KanbanTask | null;
  onClose: () => void;
  onMove: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "files" | "activity" | "output">(
    "overview",
  );
  const [detail, setDetail] = useState<TaskDetailPayload | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const taskId = task?.id ?? null;

  useEffect(() => {
    if (!taskId) return;
    // The component is keyed by task id at the call site, so a different
    // card mounts a fresh one — no state to reset here.
    let cancelled = false;
    API.get<TaskDetailPayload>(`/api/tasks/${taskId}/detail`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetailError(
            err instanceof Error ? err.message : "Could not load this task",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (!task) return null;

  const files = detail?.files ?? [];
  const spans = detail?.spans ?? [];
  const timeline = detail?.timeline ?? [
    { at: task.created_at, label: "Created" },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title="Task"
      width="lg"
      footer={
        <>
          <Button variant="danger" onClick={onDelete}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
          <Select
            value={task.status}
            onChange={(e) => onMove(e.target.value as TaskStatus)}
            aria-label="Move task to another column"
            className="w-40"
          >
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={STATUS_TONE[task.status]}>
            {COLUMNS_BY_ID[task.status]?.title ?? task.status}
          </Badge>
          <Badge>{harnessLabel(task.harness)}</Badge>
          {task.model ? (
            <span className="font-mono text-[11px] text-muted" title="Model">
              {task.model}
            </span>
          ) : null}
          {task.branch_name ? (
            <span className="font-mono text-[11px] text-muted">
              {task.branch_name}
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[10px] text-faint">
            {task.id.slice(0, 8)}
          </span>
        </div>

        <div>
          <div className="eyebrow mb-1.5">Prompt</div>
          <p className="text-[13px] text-ink whitespace-pre-wrap">
            {task.prompt}
          </p>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Metric label="Iterations" value={task.iterations} />
          <Metric label="Files changed" value={task.files_changed} />
          <Metric label="Spans" value={spans.length} />
          <Metric
            label="Duration"
            value={
              task.started_at && task.completed_at
                ? formatDuration(task.completed_at - task.started_at)
                : "—"
            }
          />
        </div>

        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={[
            { value: "overview", label: "Overview" },
            {
              value: "files",
              label: files.length ? `Files (${files.length})` : "Files",
            },
            { value: "activity", label: "Activity" },
            { value: "output", label: "Output" },
          ]}
        />

        {detailError ? (
          <p className="text-[12px] text-danger">{detailError}</p>
        ) : null}

        {tab === "overview" ? (
          <div className="flex flex-col gap-3">
            <div>
              <div className="eyebrow mb-1.5">Timeline</div>
              <ol className="flex flex-col gap-1.5">
                {timeline.map((entry) => (
                  <li
                    key={`${entry.label}-${entry.at}`}
                    className="flex items-center gap-2 text-[12px]"
                  >
                    <StatusDot
                      tone={entry.label === "Failed" ? "danger" : "ok"}
                    />
                    <span className="text-ink">{entry.label}</span>
                    <span className="ml-auto font-mono text-[11px] text-faint">
                      {new Date(entry.at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            {task.error ? (
              <div>
                <div className="eyebrow mb-1.5">Error</div>
                <pre className="font-mono text-[11px] text-danger bg-danger-soft border border-danger rounded-md p-2.5 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {task.error}
                </pre>
              </div>
            ) : null}
            {task.session_id ? (
              <p className="text-[12px] text-muted">
                Came from a chat conversation — its other messages share this
                run&rsquo;s trace in Logs.
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "files" ? (
          files.length === 0 ? (
            <p className="text-[12px] text-muted">
              {task.files_changed > 0
                ? "This run reported changed files but did not record their paths."
                : "This run left the working tree untouched."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
              {files.map((f) => (
                <li
                  key={f}
                  className="font-mono text-[11px] text-ink truncate"
                  title={f}
                >
                  {f}
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "activity" ? (
          spans.length === 0 ? (
            <p className="text-[12px] text-muted">
              No trace was recorded for this card — it was added to the board by
              hand rather than produced by a run.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
              {spans.map((sp) => (
                <li key={sp.id} className="flex items-center gap-2 text-[12px]">
                  <StatusDot tone={sp.outcome === "failed" ? "danger" : "ok"} />
                  <span className="text-faint font-mono text-[10px] w-16 shrink-0">
                    {sp.type}
                  </span>
                  <span className="text-ink truncate flex-1">{sp.name}</span>
                  <span
                    className="font-mono text-[10px] text-faint"
                    data-numeric
                  >
                    {sp.ended_at
                      ? formatDuration(sp.ended_at - sp.started_at)
                      : "…"}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "output" ? (
          task.output ? (
            <Markdown className="text-[13px] max-h-72 overflow-y-auto">
              {task.output}
            </Markdown>
          ) : (
            <p className="text-[12px] text-muted">
              This run produced no output.
            </p>
          )
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
