import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  FolderGit2,
  GitCompare,
  MessageSquare,
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

export function Dashboard() {
  const { activeProject, activeProjectId } = useProjects();
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessProbe[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Each panel degrades on its own — one missing endpoint shouldn't
    // blank the whole dashboard.
    const [agentsRes, gitRes, harnessRes] = await Promise.allSettled([
      API.get<{ agents: AgentSnapshot[] }>("/api/agents"),
      activeProjectId
        ? API.get<GitStatus>(`/api/git/status?projectId=${activeProjectId}`)
        : Promise.reject(new Error("no project")),
      API.get<{ harnesses: HarnessProbe[] }>("/api/settings/harnesses"),
    ]);

    setAgents(agentsRes.status === "fulfilled" ? agentsRes.value.agents : []);
    setGit(gitRes.status === "fulfilled" ? gitRes.value : null);
    setHarnesses(
      harnessRes.status === "fulfilled" ? harnessRes.value.harnesses : [],
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

  const working = agents.filter((a) => a.taskId);
  const idle = agents.length - working.length;
  const uncommitted = git
    ? git.staged.length + git.unstaged.length + git.untracked.length
    : null;

  return (
    <div className="p-6">
      <PageHeader
        eyebrow="Floor"
        title="Dashboard"
        description={`What the swarm is doing in ${activeProject.name}.`}
        actions={
          <Link
            to="/chat"
            className="inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-md border border-transparent bg-accent text-accent-fg text-sm font-medium transition-colors hover:bg-accent-hover"
          >
            <MessageSquare className="size-4" />
            Start a task
          </Link>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Stat
          label="Working now"
          value={working.length}
          hint={idle > 0 ? `${idle} idle` : "Everyone busy"}
          tone={working.length > 0 ? "accent" : "neutral"}
        />
        <Stat
          label="Uncommitted changes"
          value={uncommitted}
          hint={git?.branch ? `on ${git.branch}` : "Working tree unavailable"}
          tone={uncommitted ? "warn" : "neutral"}
        />
        <Stat
          label="Harnesses online"
          value={harnesses.filter((h) => h.available).length}
          hint={`of ${harnesses.length || 3} installed`}
          tone={harnesses.some((h) => h.available) ? "ok" : "danger"}
        />
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
            />
          ) : (
            <ul className="divide-y divide-line">
              {agents.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <StatusDot tone={a.taskId ? "accent" : "neutral"} pulse={!!a.taskId} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink truncate">
                      {a.name}
                      <span className="font-mono text-[11px] text-faint ml-1.5">
                        {a.harness}
                      </span>
                    </span>
                    {a.taskPrompt ? (
                      <span className="block text-[12px] text-muted truncate">
                        {a.taskPrompt}
                      </span>
                    ) : null}
                  </span>
                  <Badge tone={a.taskId ? "accent" : "neutral"}>{a.phase}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            eyebrow="This project"
            title="Working tree"
            actions={
              <Link
                to="/git-diff"
                className="text-[12px] text-accent hover:underline"
              >
                Review changes
              </Link>
            }
          />
          {git ? (
            <div className="p-4 flex flex-col gap-3">
              <Row label="Branch" value={git.branch ?? "unknown"} mono />
              <Row label="Staged" value={git.staged.length} />
              <Row label="Not staged" value={git.unstaged.length} />
              <Row label="Untracked" value={git.untracked.length} />
            </div>
          ) : (
            <EmptyState
              icon={<GitCompare />}
              title="No git data"
              description={
                activeProject.isGitRepo
                  ? "Could not read this repository."
                  : `${activeProject.name} isn't a git repository.`
              }
              className="py-8"
            />
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            eyebrow="Capacity"
            title="Harnesses"
            actions={
              <Link
                to="/settings"
                className="text-[12px] text-accent hover:underline"
              >
                Configure
              </Link>
            }
          />
          {harnesses.length === 0 ? (
            <p className="px-4 py-5 text-[13px] text-muted">
              Could not reach the server to check which harnesses are installed.
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line">
              {harnesses.map((h) => (
                <li key={h.id} className="flex items-center gap-2.5 px-4 py-3">
                  <StatusDot tone={h.available ? "ok" : "danger"} />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-ink">{h.id}</span>
                    <span className="block font-mono text-[10px] text-faint truncate">
                      {h.available ? (h.version ?? "available") : "not found"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | null;
  hint: string;
  tone: "neutral" | "accent" | "ok" | "warn" | "danger";
}) {
  const accentBar: Record<string, string> = {
    neutral: "bg-line-strong",
    accent: "bg-accent",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
  };
  return (
    <Card className="relative overflow-hidden p-4 pl-5">
      <span className={cn("absolute left-0 top-0 bottom-0 w-0.5", accentBar[tone])} />
      <div className="eyebrow mb-2">{label}</div>
      <div className="text-[28px] leading-none font-semibold text-ink" data-numeric>
        {value ?? "—"}
      </div>
      <div className="text-[12px] text-muted mt-1.5">{hint}</div>
    </Card>
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
