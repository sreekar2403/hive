import { useState } from "react";
import {
  Boxes,
  KeyRound,
  Route,
  Shield,
  SlidersHorizontal,
  SettingsIcon,
} from "lucide-react";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { cn } from "../lib/cn";
import { useSettings } from "./settings/useSettings";
import { ProvidersSection } from "./settings/ProvidersSection";
import { HarnessesSection } from "./settings/HarnessesSection";
import { RoutingSection } from "./settings/RoutingSection";
import {
  ExecutionSection,
  GeneralSection,
  PermissionsSection,
} from "./settings/SystemSections";
import type { SettingsSectionId } from "./settings/types";

const SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: typeof KeyRound;
}> = [
  {
    id: "providers",
    label: "Providers",
    description: "Model providers and API keys",
    icon: KeyRound,
  },
  {
    id: "harnesses",
    label: "Harnesses",
    description: "The CLI agents Hive drives",
    icon: Boxes,
  },
  {
    id: "routing",
    label: "Task routing",
    description: "Which model handles which work",
    icon: Route,
  },
  {
    id: "execution",
    label: "Execution",
    description: "Retries, timeouts, concurrency",
    icon: SlidersHorizontal,
  },
  {
    id: "permissions",
    label: "Permissions",
    description: "Approval before destructive work",
    icon: Shield,
  },
  {
    id: "general",
    label: "General",
    description: "Theme, defaults, storage",
    icon: SettingsIcon,
  },
];

export function SettingsPage() {
  const [section, setSection] = useState<SettingsSectionId>("providers");
  const {
    draft,
    keyDrafts,
    loading,
    error,
    saving,
    dirty,
    update,
    setProviderKeyDraft,
    discard,
    save,
    reload,
  } = useSettings();

  const active = SECTIONS.find((s) => s.id === section)!;

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader eyebrow="Inspect" title="Settings" />
        <p className="text-[13px] text-muted">Loading settings…</p>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="p-6 h-full flex flex-col">
        <PageHeader eyebrow="Inspect" title="Settings" />
        <EmptyState
          icon={<SettingsIcon />}
          title="Settings are unavailable"
          description={error ?? "The Hive server isn't reachable right now."}
          action={<Button onClick={reload}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Inspect"
          title="Settings"
          description="Wire up providers, choose which model does which kind of work, and set the limits the swarm runs under."
        />
      </div>

      <div className="flex-1 min-h-0 flex border-t border-line">
        <nav className="w-56 shrink-0 border-r border-line bg-surface p-2 overflow-y-auto">
          {SECTIONS.map(({ id, label, description, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              aria-current={section === id ? "page" : undefined}
              className={cn(
                "w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors mb-0.5",
                section === id
                  ? "bg-accent-soft text-ink"
                  : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0 mt-0.5",
                  section === id ? "text-accent" : "text-faint",
                )}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{label}</span>
                <span className="block text-[11px] text-faint leading-snug">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl">
              <div className="mb-5">
                <div className="eyebrow mb-1">Settings</div>
                <h2 className="text-[17px] font-semibold text-ink">{active.label}</h2>
              </div>

              {error ? (
                <div className="mb-4 px-3 py-2 rounded-md border border-danger bg-danger-soft text-[13px] text-danger">
                  {error}
                </div>
              ) : null}

              {section === "providers" ? (
                <ProvidersSection
                  draft={draft}
                  keyDrafts={keyDrafts}
                  onChange={update}
                  onKeyChange={setProviderKeyDraft}
                />
              ) : null}
              {section === "harnesses" ? (
                <HarnessesSection draft={draft} onChange={update} />
              ) : null}
              {section === "routing" ? (
                <RoutingSection draft={draft} onChange={update} />
              ) : null}
              {section === "execution" ? (
                <ExecutionSection draft={draft} onChange={update} />
              ) : null}
              {section === "permissions" ? (
                <PermissionsSection draft={draft} onChange={update} />
              ) : null}
              {section === "general" ? (
                <GeneralSection draft={draft} onChange={update} />
              ) : null}
            </div>
          </div>

          {/* Only appears once something has actually changed. */}
          {dirty ? (
            <div className="shrink-0 border-t border-line bg-surface px-6 py-3 flex items-center justify-between gap-4">
              <span className="text-[13px] text-muted">You have unsaved changes.</span>
              <div className="flex items-center gap-2">
                <Button onClick={discard} disabled={saving}>
                  Discard
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void save().catch(() => undefined)}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
