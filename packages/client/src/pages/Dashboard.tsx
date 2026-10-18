import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  FolderGit2,
  GitCompare,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusDot,
} from "../components/ui";
import { API, subscribeToEvents } from "../lib/api";
import { useProjects } from "../state/ProjectContext";
import { cn } from "../lib/cn";
import { STATUS_LABEL, STATUS_TONE } from "./kanban/constants";
import type { KanbanTask } from "./kanban/types";
import { formatRelativeTime } from "./memory/format";
import { useActivityStats } from "./dashboard/useActivityStats";
import { ActivityHeatmap } from "./dashboard/ActivityHeatmap";
import { GrowthPanel } from "./dashboard/GrowthPanel";
import { SecondBrainPromo } from "./dashboard/SecondBrainPromo";

interface AgentSnapshot {
  id: string;
  name: string;
  harness: string;
  phase: string;
  taskId: string | null;
  taskPrompt: string | null;
  startedAt: number | null;
}

interface GitStatus {
  branch: string | null;
  staged: unknown[];
  unstaged: unknown[];
  untracked: unknown[];
}

interface HarnessProbe {
  id: string;
  available: boolean;
  version: string | null;
}

type Scope = "project" | "all";
type Tab = "activity" | "growth";

export function Dashboard() {
  const { activeProject, activeProjectId } = useProjects();
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessProbe[]>([]);
  const [recent, setRecent] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("project");
  const [tab, setTab] = useState<Tab>("activity");
  const [brainEnabled, setBrainEnabled] = useState<boolean | null>(null);

  const statsProjectId = scope === "all" ? null : activeProjectId;
  const { stats, loading: statsLoading, error: statsError } =
    useActivityStats(statsProjectId, Boolean(activeProject));

  const load = useCallback(async () => {
    // Each panel degrades on its own — one missing endpoint shouldn't
    // blank the whole dashboard.
    const [agentsRes, gitRes, harnessRes, tasksRes, settingsRes] =
      await Promise.allSettled([
        API.get<{ agents: AgentSnapshot[] }>("/api/agents"),
        activeProjectId
          ? API.get<GitStatus>(`/api/git/status?projectId=${activeProjectId}`)
          : Promise.reject(new Error("no project")),
        API.get<{ harnesses: HarnessProbe[] }>("/api/settings/harnesses"),
        activeProjectId
          ? API.get<{ tasks: KanbanTask[]; total: number }>(
              `/api/tasks?projectId=${encodeURIComponent(activeProjectId)}&limit=20`,
            )
          : Promise.reject(new Error("no project")),
        API.get<{ secondBrain?: { enabled?: boolean } }>("/api/settings"),
      ]);

    setAgents(agentsRes.status === "fulfilled" ? agentsRes.value.agents : []);
    setGit(gitRes.status === "fulfilled" ? gitRes.value : null);
    setHarnesses(
      harnessRes.status === "fulfilled" ? harnessRes.value.harnesses : [],
    );
    setRecent(
      tasksRes.status === "fulfilled"
        ? [...tasksRes.value.tasks]
            .sort((a, b) => b.updated_at - a.updated_at)
            .slice(0, 5)
        : [],
    );
    setBrainEnabled(
      settingsRes.status === "fulfilled"
        ? (settingsRes.value.secondBrain?.enabled ?? false)
        : null,
    );
    setLoading(false);
  }, [activeProjectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const unsubscribe = subscribeToEvents(() => void load());
    const interval = setInterval(() => void load(), 15000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [load]);

  if (!activeProject) {
    return (
      <div className="p-6 h-full flex flex-col">
        <PageHeader eyebrow="Floor" title="Dashboard" />
        <EmptyState
          icon={<FolderGit2 />}
          title="No project yet"
          description="Add a git repository from the switcher above and Hive will start working on it."
        />
      </div>
    );
  }

  const uncommitted = git
    ? git.staged.length + git.unstaged.length + git.untracked.length
    : null;

  const totals = stats?.totals;
  const heroLine = totals
    ? `Hive has been working here for ${totals.activeDays} active day${
        totals.activeDays === 1 ? "" : "s"
      } across ${totals.runs} run${totals.runs === 1 ? "" : "s"} — ${
        totals.currentStreak
      }-day streak`
    : "Loading activity…";

  return (
    <div className="p-6">
      {/* Hero — observability header, Kimi-style */}
      <div className="flex items-start justify-between gap-6 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span
              className="inline-flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg"
              aria-hidden="true"
            >
              <Sparkles className="size-4" />
            </span>
            <h1 className="text-[20px] font-semibold text-ink truncate">
              {scope === "all" ? "Hive" : `Hive × ${activeProject.name}`}
            </h1>
          </div>
          <p className="text-[13px] text-muted max-w-[70ch]">{heroLine}</p>
        </div>
        <div
          className="inline-flex rounded-md border border-line bg-surface-2 p-0.5 shrink-0"
          role="group"
          aria-label="Activity scope"
        >
          <ScopeButton
            active={scope === "project"}
            onClick={() => setScope("project")}
          >
            Project
          </ScopeButton>
          <ScopeButton active={scope === "all"} onClick={() => setScope("all")}>
            All
          </ScopeButton>
        </div>
      </div>

      {/* Closeness / Growth tabs */}
      <div className="flex items-center gap-1 mb-3 border-b border-line">
        <TabButton
          active={tab === "activity"}
          onClick={() => setTab("activity")}
        >
          Activity
        </TabButton>
        <TabButton active={tab === "growth"} onClick={() => setTab("growth")}>
          Growth
        </TabButton>
      </div>

      <Card className="mb-4">
        {tab === "activity" ? (
          <>
            <p className="px-4 pt-3 text-[13px] text-muted">
              The more you run tasks, the more you build together.
            </p>
            {statsLoading ? (
              <p className="px-4 py-8 text-[13px] text-muted">Loading…</p>
            ) : statsError || !stats ? (
              <EmptyState
                icon={<Building2 />}
                title="No activity data yet"
                description={
                  statsError ?? "Run a task and the heatmap will light up."
                }
                className="py-10"
              />
            ) : stats.totals.runs === 0 ? (
              <EmptyState
                icon={<MessageSquare />}
                title="No runs yet"
                description="Queue work from the board or send it straight from chat — each run adds a square here."
                className="py-10"
                action={
                  <Link
                    to="/chat"
                    className="inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-md border border-transparent bg-accent text-accent-fg text-sm font-medium transition-colors hover:bg-accent-hover"
                  >
                    <MessageSquare className="size-4" />
                    Start a task
                  </Link>
                }
              />
            ) : (
              <ActivityHeatmap
                days={stats.days}
                periodDays={stats.periodDays}
              />
            )}
          </>
        ) : statsLoading ? (
          <p className="px-4 py-8 text-[13px] text-muted">Loading…</p>
        ) : statsError || !stats ? (
          <EmptyState
            icon={<Building2 />}
            title="No growth data yet"
            description={statsError ?? "Complete a few tasks to see trends."}
            className="py-10"
          />
        ) : (
          <GrowthPanel stats={stats} />
        )}
      </Card>

      <div className="mb-4">
        <SecondBrainPromo enabled={brainEnabled} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            eyebrow="Right now"
            title="On the floor"
            actions={
              <Link
                to="/office"
                className="text-[12px] text-accent hover:underline"
              >
                Open Office
              </Link>
            }
          />
          {loading ? (
            <p className="px-4 py-6 text-[13px] text-muted">Loading…</p>
          ) : agents.length === 0 ? (
            <EmptyState
              icon={<Building2 />}
              title="Nobody has clocked in"
              description="Agents appear once a harness is available and a task is running."
              className="py-8"
              action={
                <Link
                  to="/chat"
                  className="inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-md border border-transparent bg-accent text-accent-fg text-sm font-medium transition-colors hover:bg-accent-hover"
                >
                  <MessageSquare className="size-4" />
                  Start a task
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {agents.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <StatusDot
                    tone={a.taskId ? "accent" : "neutral"}
                    pulse={!!a.taskId}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink truncate">
                      {a.name}
                      <span className="font-mono text-[11px] text-muted ml-1.5">
                        {a.harness}
                      </span>
                    </span>
                    {a.taskPrompt ? (
                      <span className="block text-[12px] text-muted truncate">
                        {a.taskPrompt}
                      </span>
                    ) : null}
                  </span>
                  <Badge tone={a.taskId ? "accent" : "neutral"}>
                    {a.phase}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            eyebrow="Momentum"
            title="Latest activity"
            actions={
              <Link
                to="/kanban"
                className="text-[12px] text-accent hover:underline"
              >
                Open board
              </Link>
            }
          />
          {loading ? (
            <p className="px-4 py-6 text-[13px] text-muted">Loading…</p>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<MessageSquare />}
              title="No tasks yet"
              description="Queue work from the board or send it straight from chat."
              className="py-8"
              action={
                <Link
                  to="/chat"
                  className="inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-md border border-transparent bg-accent text-accent-fg text-sm font-medium transition-colors hover:bg-accent-hover"
                >
                  <MessageSquare className="size-4" />
                  Start a task
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((t) => (
                <li key={t.id}>
                  <Link
                    to="/kanban"
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors"
                  >
                    <Badge tone={STATUS_TONE[t.status]}>
                      {STATUS_LABEL[t.status]}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {t.title?.trim() || t.prompt}
                    </span>
                    <span
                      className="font-mono text-[11px] text-muted shrink-0"
                      data-numeric
                    >
                      {formatRelativeTime(t.updated_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            eyebrow="This project"
            title="Working tree & harnesses"
            actions={
              <Link
                to="/git-diff"
                className="text-[12px] text-accent hover:underline"
              >
                Review changes
              </Link>
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line">
            <div className="p-4 flex flex-col gap-2">
              {git ? (
                <>
                  <Row label="Branch" value={git.branch ?? "unknown"} mono />
                  <Row label="Uncommitted" value={uncommitted ?? 0} />
                </>
              ) : (
                <p className="text-[13px] text-muted">
                  {activeProject.isGitRepo
                    ? "Could not read this repository."
                    : `${activeProject.name} isn't a git repository.`}
                </p>
              )}
              <Link
                to="/git-diff"
                className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline mt-1"
              >
                <GitCompare className="size-3.5" />
                Open diff
              </Link>
            </div>
            <ul className="divide-y divide-line">
              {harnesses.length === 0 ? (
                <li className="px-4 py-3 text-[13px] text-muted">
                  Could not reach the server to check harnesses.
                </li>
              ) : (
                harnesses.map((h) => (
                  <li key={h.id} className="flex items-center gap-2.5 px-4 py-2">
                    <StatusDot tone={h.available ? "ok" : "danger"} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink">{h.id}</span>
                      <span className="block font-mono text-[11px] text-muted truncate">
                        {h.available ? (h.version ?? "available") : "not found"}
                      </span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-3 h-7 rounded-[5px] text-[12px] font-medium transition-colors",
        active
          ? "bg-surface text-ink shadow-sm"
          : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={cn(
        "px-3.5 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-accent text-ink"
          : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-muted">{label}</span>
      <span
        className={cn("text-[13px] text-ink", mono && "font-mono text-[12px]")}
        data-numeric
      >
        {value}
      </span>
    </div>
  );
}
