import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, GitCommitHorizontal, GitCompare, RefreshCw } from "lucide-react";
import {
  Badge,
  EmptyState,
  IconButton,
  PageHeader,
  SegmentedControl,
} from "../components/ui";
import { API } from "../lib/api";
import { useStickyState } from "../lib/useStickyState";
import { useProjects } from "../state/ProjectContext";
import { cn } from "../lib/cn";
import {
  CHANGE_TYPE_LABEL,
  CHANGE_TYPE_TONE,
  parsePatch,
  type Commit,
  type GitDiff,
  type GitFileEntry,
  type GitStatus,
} from "./changes/diff";

type View = "working" | "staged" | "history";

export function GitDiffPage() {
  const { activeProject, activeProjectId } = useProjects();
  // Which tab you were on and which file you had open survive a trip
  // to another screen; the lists themselves are always re-read.
  const [view, setView] = useStickyState<View>("git.view", "working");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selected, setSelected] = useStickyState<string | null>(
    "git.selectedFile",
    null,
  );
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const staged = view === "staged";

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = `projectId=${encodeURIComponent(activeProjectId)}`;
    const [s, l] = await Promise.allSettled([
      API.get<GitStatus>(`/api/git/status?${q}`),
      API.get<{ commits: Commit[] }>(`/api/git/log?${q}&limit=30`),
    ]);
    setStatus(s.status === "fulfilled" ? s.value : null);
    setCommits(l.status === "fulfilled" ? l.value.commits : []);
    setLoading(false);
  }, [activeProjectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const files = useMemo(() => {
    if (!status) return [];
    return staged ? status.staged : [...status.unstaged, ...status.untracked];
  }, [status, staged]);

  // Keep a valid selection as the file list changes.
  useEffect(() => {
    setSelected((current) =>
      current && files.some((f) => f.path === current)
        ? current
        : (files[0]?.path ?? null),
    );
  }, [files, setSelected]);

  useEffect(() => {
    if (!activeProjectId || !selected || view === "history") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    API.get<GitDiff>(
      `/api/git/diff?projectId=${encodeURIComponent(activeProjectId)}&file=${encodeURIComponent(selected)}&staged=${staged}`,
    )
      .then((d) => !cancelled && setDiff(d))
      .catch(() => !cancelled && setDiff(null))
      .finally(() => !cancelled && setLoadingDiff(false));
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, selected, staged, view]);

  // j/k move between files, matching the muscle memory of git tooling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = files.findIndex((f) => f.path === selected);
      const next = e.key === "j" ? i + 1 : i - 1;
      if (next >= 0 && next < files.length) setSelected(files[next].path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files, selected, setSelected]);

  if (!activeProject) {
    return (
      <div className="p-6 h-full flex flex-col">
        <PageHeader eyebrow="Inspect" title="Changes" />
        <EmptyState
          icon={<FolderGit2 />}
          title="No project selected"
          description="Pick a project from the switcher above to review its changes."
        />
      </div>
    );
  }

  if (!activeProject.isGitRepo) {
    return (
      <div className="p-6 h-full flex flex-col">
        <PageHeader eyebrow="Inspect" title="Changes" />
        <EmptyState
          icon={<GitCompare />}
          title={`${activeProject.name} isn't a git repository`}
          description="Hive reviews changes through git. Run git init in that folder to track them."
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Inspect"
          title="Changes"
          description="Review what the swarm wrote before it lands."
          actions={
            <div className="flex items-center gap-2">
              {status ? (
                <span className="flex items-center gap-2 text-[12px] text-muted">
                  <span className="font-mono">{status.branch}</span>
                  {status.ahead > 0 ? <Badge tone="info">↑{status.ahead}</Badge> : null}
                  {status.behind > 0 ? <Badge tone="warn">↓{status.behind}</Badge> : null}
                </span>
              ) : null}
              <SegmentedControl<View>
                value={view}
                onChange={setView}
                options={[
                  { value: "working", label: "Working" },
                  { value: "staged", label: "Staged" },
                  { value: "history", label: "History" },
                ]}
              />
              <IconButton onClick={() => void load()} aria-label="Refresh">
                <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              </IconButton>
            </div>
          }
        />
      </div>

      <div className="flex-1 min-h-0 border-t border-line">
        {view === "history" ? (
          <CommitList commits={commits} loading={loading} />
        ) : (
          <div className="h-full flex">
            <div
              ref={listRef}
              className="w-80 shrink-0 border-r border-line overflow-y-auto"
            >
              {loading ? (
                <p className="px-4 py-4 text-[13px] text-muted">Reading the tree…</p>
              ) : files.length === 0 ? (
                <EmptyState
                  icon={<GitCompare />}
                  title={staged ? "Nothing staged" : "Working tree is clean"}
                  description={
                    staged
                      ? "Stage a change to review it here."
                      : `Nothing to review on ${status?.branch ?? "this branch"}.`
                  }
                  className="py-10"
                />
              ) : (
                <ul>
                  {files.map((f) => (
                    <FileRow
                      key={f.path}
                      file={f}
                      selected={f.path === selected}
                      onSelect={() => setSelected(f.path)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="flex-1 min-w-0 overflow-auto">
              <DiffView diff={diff} loading={loadingDiff} hasFiles={files.length > 0} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  selected,
  onSelect,
}: {
  file: GitFileEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left border-l-2 transition-colors",
          selected
            ? "bg-accent-soft border-accent"
            : "border-transparent hover:bg-surface-2",
        )}
      >
        <Badge tone={CHANGE_TYPE_TONE[file.changeType]}>
          {CHANGE_TYPE_LABEL[file.changeType]}
        </Badge>
        {/* CSS truncation rather than a character count: it adapts to the
            pane width instead of guessing at it. */}
        <span
          className="flex-1 min-w-0 font-mono text-[12px] text-ink truncate"
          title={file.path}
          dir="rtl"
        >
          {file.path}
        </span>
        {file.binary ? (
          <span className="font-mono text-[10px] text-faint">bin</span>
        ) : (
          <span className="font-mono text-[10px] whitespace-nowrap" data-numeric>
            {file.added ? <span className="text-ok">+{file.added}</span> : null}
            {file.removed ? <span className="text-danger ml-1">−{file.removed}</span> : null}
          </span>
        )}
      </button>
    </li>
  );
}

function DiffView({
  diff,
  loading,
  hasFiles,
}: {
  diff: GitDiff | null;
  loading: boolean;
  hasFiles: boolean;
}) {
  const lines = useMemo(() => (diff ? parsePatch(diff.patch) : []), [diff]);

  if (loading) {
    return <p className="px-4 py-4 text-[13px] text-muted">Loading diff…</p>;
  }
  if (!hasFiles) return null;
  if (!diff) {
    return <p className="px-4 py-4 text-[13px] text-muted">Select a file to see its diff.</p>;
  }
  if (diff.binary) {
    return (
      <EmptyState
        title="Binary file"
        description={`${diff.path} can't be shown as text.`}
        className="py-16"
      />
    );
  }
  if (diff.tooLarge) {
    return (
      <EmptyState
        title="File too large to display"
        description={`${diff.path} changed by ${diff.added + diff.removed} lines. Open it in your editor instead.`}
        className="py-16"
      />
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-surface border-b border-line">
        <span className="font-mono text-[12px] text-ink truncate">{diff.path}</span>
        <span className="font-mono text-[11px] ml-auto whitespace-nowrap" data-numeric>
          <span className="text-ok">+{diff.added}</span>
          <span className="text-danger ml-1.5">−{diff.removed}</span>
        </span>
      </div>

      <table className="w-full border-collapse font-mono text-[12px]">
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={i}
              className={cn(
                line.kind === "add" && "bg-ok-soft",
                line.kind === "remove" && "bg-danger-soft",
                line.kind === "hunk" && "bg-surface-2",
              )}
            >
              <td className="w-12 px-2 text-right text-faint select-none align-top" data-numeric>
                {line.oldNo ?? ""}
              </td>
              <td className="w-12 px-2 text-right text-faint select-none align-top" data-numeric>
                {line.newNo ?? ""}
              </td>
              <td
                className={cn(
                  "w-4 text-center select-none align-top",
                  line.kind === "add" && "text-ok",
                  line.kind === "remove" && "text-danger",
                )}
              >
                {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}
              </td>
              <td
                className={cn(
                  "pr-4 whitespace-pre-wrap break-all align-top",
                  line.kind === "hunk" ? "text-muted" : "text-ink",
                )}
              >
                {line.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommitList({ commits, loading }: { commits: Commit[]; loading: boolean }) {
  if (loading) {
    return <p className="px-6 py-4 text-[13px] text-muted">Reading history…</p>;
  }
  if (commits.length === 0) {
    return (
      <EmptyState
        icon={<GitCommitHorizontal />}
        title="No commits yet"
        description="Commits on this branch will show up here."
      />
    );
  }
  return (
    <ul className="divide-y divide-line">
      {commits.map((c) => (
        <li key={c.hash} className="flex items-start gap-3 px-6 py-3">
          <span className="font-mono text-[11px] text-accent shrink-0 pt-0.5">
            {c.shortHash}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-ink">{c.subject}</span>
            <span className="block text-[11px] text-faint">
              {c.author} · {c.date}
            </span>
          </span>
          <span className="font-mono text-[11px] whitespace-nowrap pt-0.5" data-numeric>
            <span className="text-muted">{c.filesChanged}f</span>
            {c.insertions ? <span className="text-ok ml-1.5">+{c.insertions}</span> : null}
            {c.deletions ? <span className="text-danger ml-1">−{c.deletions}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
