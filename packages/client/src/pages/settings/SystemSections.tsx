import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Switch,
} from "../../components/ui";
import { useTheme } from "../../components/ui";
import { useProjects } from "../../state/ProjectContext";
import type { SettingsConfig } from "./types";

type Change = (updater: (prev: SettingsConfig) => SettingsConfig) => void;

/** How hard and how wide the swarm is allowed to run. */
export function ExecutionSection({
  draft,
  onChange,
}: {
  draft: SettingsConfig;
  onChange: Change;
}) {
  const setLoop = (patch: Partial<SettingsConfig["loop"]>) =>
    onChange((prev) => ({ ...prev, loop: { ...prev.loop, ...patch } }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted max-w-[62ch]">
        An agent retries its own work until it succeeds or runs out of attempts.
        These limits decide how long that can go on.
      </p>

      <Card>
        <CardHeader eyebrow="Limits" title="Task execution" />
        <div className="p-4 grid grid-cols-2 gap-4">
          <Field
            label="Attempts per task"
            hint="How many times an agent may retry before giving up."
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={50}
                value={draft.loop.maxIterations}
                onChange={(e) =>
                  setLoop({ maxIterations: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            )}
          </Field>
          <Field label="Timeout per task" hint="In seconds.">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={10}
                step={10}
                value={Math.round(draft.loop.timeoutMs / 1000)}
                onChange={(e) =>
                  setLoop({ timeoutMs: (Number(e.target.value) || 60) * 1000 })
                }
              />
            )}
          </Field>
          <Field
            label="Agents at once"
            hint="Across every harness. Higher uses more of your machine."
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={32}
                value={draft.loop.maxConcurrentAgents}
                onChange={(e) =>
                  setLoop({
                    maxConcurrentAgents: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">Retry on failure</span>
            <div className="flex items-center gap-2 h-9">
              <Switch
                checked={draft.loop.retry.enabled}
                onChange={(v) =>
                  setLoop({ retry: { ...draft.loop.retry, enabled: v } })
                }
                label="Retry failed tasks"
              />
              <span className="text-[12px] text-muted">
                {draft.loop.retry.enabled
                  ? `Up to ${draft.loop.retry.maxRetries} times`
                  : "Off"}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** The approval gate that pauses agents before destructive work. */
export function PermissionsSection({
  draft,
  onChange,
}: {
  draft: SettingsConfig;
  onChange: Change;
}) {
  const [newAction, setNewAction] = useState("");
  const actions = draft.permission.destructiveActions;

  const setPermission = (patch: Partial<SettingsConfig["permission"]>) =>
    onChange((prev) => ({ ...prev, permission: { ...prev.permission, ...patch } }));

  const addAction = () => {
    const value = newAction.trim().toLowerCase();
    if (!value || actions.includes(value)) return;
    setPermission({ destructiveActions: [...actions, value] });
    setNewAction("");
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted max-w-[62ch]">
        When a task mentions one of these words, Hive stops and waits for you to
        approve it on the Permissions screen before the agent runs.
      </p>

      <Card>
        <CardHeader
          eyebrow="Approval gate"
          title="Pause before destructive work"
          actions={
            <Switch
              checked={draft.permission.enabled}
              onChange={(v) => setPermission({ enabled: v })}
              label="Enable approval gate"
            />
          }
        />
        <div className="p-4 flex flex-col gap-4">
          <Field
            label="Wait for a decision"
            hint="In seconds. If nobody answers in time, the task is denied."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={5}
                step={5}
                value={Math.round(draft.permission.timeout / 1000)}
                onChange={(e) =>
                  setPermission({ timeout: (Number(e.target.value) || 60) * 1000 })
                }
              />
            )}
          </Field>

          <div>
            <div className="eyebrow mb-2">Words that trigger approval</div>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {actions.map((action) => (
                <span
                  key={action}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-sm border border-line bg-surface-2 font-mono text-[11px] text-ink"
                >
                  {action}
                  <button
                    onClick={() =>
                      setPermission({
                        destructiveActions: actions.filter((a) => a !== action),
                      })
                    }
                    className="text-faint hover:text-danger transition-colors"
                    aria-label={`Remove ${action}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {actions.length === 0 ? (
                <span className="text-[12px] text-muted">
                  Nothing listed — no task will be gated.
                </span>
              ) : null}
            </div>
            <div className="flex gap-2 max-w-sm">
              <Input
                className="h-8 text-[12px] font-mono"
                value={newAction}
                onChange={(e) => setNewAction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAction()}
                placeholder="force-push"
                aria-label="New trigger word"
              />
              <Button size="sm" onClick={addAction} disabled={!newAction.trim()}>
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Appearance and where Hive keeps its data. */
export function GeneralSection({
  draft,
  onChange,
}: {
  draft: SettingsConfig;
  onChange: Change;
}) {
  const { theme, setTheme } = useTheme();
  const { projects } = useProjects();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader eyebrow="Appearance" title="Theme" />
        <div className="p-4">
          <Field label="Colour theme" className="max-w-xs">
            {(id) => (
              <Select
                id={id}
                value={theme}
                onChange={(e) => setTheme(e.target.value as "light" | "dark")}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Defaults" title="Projects" />
        <div className="p-4">
          <Field
            label="Open this project on launch"
            hint="Add projects from the switcher in the top bar."
            className="max-w-sm"
          >
            {(id) => (
              <Select
                id={id}
                value={draft.general.defaultProjectId}
                onChange={(e) =>
                  onChange((prev) => ({
                    ...prev,
                    general: { ...prev.general, defaultProjectId: e.target.value },
                  }))
                }
              >
                <option value="">Last used</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Scope" title="General workspace" />
        <div className="p-4">
          <Field
            label="Working folder"
            hint="Where chats that belong to no repository run. Leave blank for ~/.hive/workspace. Created and git-initialised on first use."
          >
            {(id) => (
              <Input
                id={id}
                className="font-mono text-[12px]"
                placeholder="~/.hive/workspace"
                value={draft.general.rootDirectory}
                onChange={(e) =>
                  onChange((prev) => ({
                    ...prev,
                    general: { ...prev.general, rootDirectory: e.target.value },
                  }))
                }
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Storage" title="Where Hive keeps data" />
        <div className="p-4 flex flex-col gap-4">
          <Field label="Cache folder" hint="Shared memory and session files.">
            {(id) => (
              <Input
                id={id}
                className="font-mono text-[12px]"
                value={draft.storage.cacheDir}
                onChange={(e) =>
                  onChange((prev) => ({
                    ...prev,
                    storage: { ...prev.storage, cacheDir: e.target.value },
                  }))
                }
              />
            )}
          </Field>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">Server port</span>
            <Badge>{draft.server.port}</Badge>
            <span className="text-[12px] text-faint">
              Change with the PORT environment variable, then restart.
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
