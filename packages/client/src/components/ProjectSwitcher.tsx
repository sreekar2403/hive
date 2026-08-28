import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  FolderGit2,
  Globe,
  Plus,
} from "lucide-react";
import { useProjects, type Project } from "../state/ProjectContext";
import { Button, Field, Input, Modal } from "./ui";
import { cn } from "../lib/cn";

/**
 * The project switcher scopes the whole app. It sits in the top bar so
 * every screen makes it obvious which working tree you are looking at.
 */
export function ProjectSwitcher() {
  const { projects, activeProject, setActiveProjectId, addProject } =
    useProjects();

  // The General workspace is pinned above the rule: it is always there,
  // and grouping it with real repositories made it read as one.
  const general = projects.find((p) => p.virtual) ?? null;
  const repositories = projects.filter((p) => !p.virtual);

  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleAdd() {
    setSaving(true);
    setError(null);
    try {
      await addProject({ path, name: name || undefined });
      setAdding(false);
      setPath("");
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex items-center gap-2.5 h-8 pl-2 pr-2 rounded-md border transition-colors max-w-[16rem]",
            open
              ? "bg-surface-2 border-line-strong"
              : "bg-transparent border-transparent hover:bg-surface-2 hover:border-line",
          )}
        >
          {activeProject?.virtual ? (
            <Globe className="size-3.5 text-accent shrink-0" />
          ) : activeProject ? (
            <span
              className="size-2 rounded-full shrink-0"
              style={{
                background: activeProject.color ?? "var(--hive-accent)",
              }}
            />
          ) : (
            <FolderGit2 className="size-3.5 text-faint shrink-0" />
          )}
          <span className="text-[13px] font-medium text-ink truncate">
            {activeProject?.name ?? "No project"}
          </span>
          {activeProject?.branch ? (
            <span className="font-mono text-[10px] text-faint truncate hidden sm:inline">
              {activeProject.branch}
            </span>
          ) : null}
          <ChevronsUpDown className="size-3.5 text-faint shrink-0" />
        </button>

        {open ? (
          <div
            role="listbox"
            className="absolute left-0 top-full mt-1.5 w-[19rem] z-40 bg-surface border border-line rounded-lg shadow-pop overflow-hidden"
          >
            {general ? (
              <>
                <div className="eyebrow px-3 pt-2.5 pb-1.5">Anything</div>
                <Option
                  project={general}
                  active={general.id === activeProject?.id}
                  onSelect={() => {
                    setActiveProjectId(general.id);
                    setOpen(false);
                  }}
                />
                <div className="rule mx-3 my-1" />
              </>
            ) : null}

            <div className="eyebrow px-3 pt-1.5 pb-1.5">Repositories</div>
            <div className="max-h-64 overflow-y-auto pb-1">
              {repositories.length === 0 ? (
                <p className="px-3 pb-3 text-[13px] text-muted">
                  None yet. Add a git repository to put the swarm to work on
                  your own code.
                </p>
              ) : (
                repositories.map((p) => (
                  <Option
                    key={p.id}
                    project={p}
                    active={p.id === activeProject?.id}
                    onSelect={() => {
                      setActiveProjectId(p.id);
                      setOpen(false);
                    }}
                  />
                ))
              )}
            </div>
            <div className="border-t border-line p-1">
              <button
                onClick={() => {
                  setOpen(false);
                  setAdding(true);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-muted hover:bg-surface-2 hover:text-ink transition-colors"
              >
                <Plus className="size-3.5" />
                Add project
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add project"
        description="Point Hive at a git repository on this machine."
        width="md"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleAdd}
              disabled={!path || saving}
            >
              {saving ? "Adding…" : "Add project"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label="Repository folder"
            required
            hint="Absolute path, e.g. C:\\Users\\you\\code\\my-app"
            error={error}
          >
            {(id) => (
              <Input
                id={id}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="C:\\Users\\you\\code\\my-app"
                autoFocus
                className="font-mono text-[13px]"
              />
            )}
          </Field>
          <Field label="Display name" hint="Defaults to the folder name.">
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-app"
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}

/**
 * One row in the switcher. The secondary line is the most useful thing
 * that is true of this scope: a branch for a repository, the folder for
 * the General workspace, and the problem when the folder has gone.
 */
function Option({
  project,
  active,
  onSelect,
}: {
  project: Project;
  active: boolean;
  onSelect: () => void;
}) {
  const subtitle = !project.exists
    ? "Folder not found"
    : project.virtual
      ? project.path
      : (project.branch ?? project.path);

  return (
    <button
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
    >
      {project.virtual ? (
        <Globe className="size-3.5 text-accent shrink-0" />
      ) : (
        <span
          className="size-2 rounded-full shrink-0 ml-0.5 mr-1"
          style={{ background: project.color ?? "var(--hive-accent)" }}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] text-ink truncate">{project.name}</span>
          {project.virtual ? (
            <span className="eyebrow shrink-0">no repo</span>
          ) : null}
          {!project.exists ? (
            <AlertTriangle className="size-3 text-warn shrink-0" />
          ) : null}
        </span>
        <span className="block font-mono text-[10px] text-faint truncate">
          {subtitle}
        </span>
      </span>
      {active ? <Check className="size-3.5 text-accent shrink-0" /> : null}
    </button>
  );
}
