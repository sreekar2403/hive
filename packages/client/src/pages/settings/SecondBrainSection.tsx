import { useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Switch,
  Textarea,
} from "../../components/ui";
import type { SettingsConfig } from "./types";

type Change = (updater: (prev: SettingsConfig) => SettingsConfig) => void;

export function SecondBrainSection({
  draft,
  onChange,
}: {
  draft: SettingsConfig;
  onChange: Change;
}) {
  const [soulContent, setSoulContent] = useState("");
  const [soulLoading, setSoulLoading] = useState(false);
  const [soulError, setSoulError] = useState<string | null>(null);

  const setSecondBrain = (patch: Partial<SettingsConfig["secondBrain"]>) =>
    onChange((prev) => ({ ...prev, secondBrain: { ...prev.secondBrain, ...patch } }));

  const setLearning = (patch: Partial<SettingsConfig["secondBrain"]["learning"]>) =>
    setSecondBrain({ learning: { ...draft.secondBrain.learning, ...patch } });

  const setTriggers = (patch: Partial<SettingsConfig["secondBrain"]["learning"]["triggers"]>) =>
    setLearning({ triggers: { ...draft.secondBrain.learning.triggers, ...patch } });

  const setRouting = (patch: Partial<SettingsConfig["secondBrain"]["routing"]>) =>
    setSecondBrain({ routing: { ...draft.secondBrain.routing, ...patch } });

  const setRetrieval = (patch: Partial<SettingsConfig["secondBrain"]["retrieval"]>) =>
    setSecondBrain({ retrieval: { ...draft.secondBrain.retrieval, ...patch } });

  const fetchSoul = async () => {
    setSoulLoading(true);
    setSoulError(null);
    try {
      const res = await fetch("/api/brain/soul");
      if (!res.ok) throw new Error("Failed to load soul.md");
      const data = await res.json();
      setSoulContent(data.content ?? "");
    } catch (err) {
      setSoulError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSoulLoading(false);
    }
  };

  const saveSoul = async () => {
    setSoulLoading(true);
    setSoulError(null);
    try {
      const res = await fetch("/api/brain/soul", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: soulContent }),
      });
      if (!res.ok) throw new Error("Failed to save soul.md");
    } catch (err) {
      setSoulError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSoulLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted max-w-[62ch]">
        The Second Brain is a learning memory layer that observes your preferences
        and which harnesses win which tasks. It builds a local knowledge graph and
        a <code className="font-mono text-[12px] bg-muted px-1 rounded">soul.md</code>
        that agents can reference. Two scopes exist: <strong>Global</strong> (shared
        across all projects at <code className="font-mono text-[12px] bg-muted px-1 rounded">~/.hive/mem</code>)
        and <strong>Project</strong> (per-repo at <code className="font-mono text-[12px] bg-muted px-1 rounded">mem/</code>,
        checked into git). Project scope overrides global when both are enabled.
      </p>

      <Card>
        <CardHeader
          eyebrow="Second Brain"
          title="Enable layer"
          actions={
            <Switch
              checked={draft.secondBrain.enabled}
              onChange={(v) => setSecondBrain({ enabled: v })}
              label="Enabled"
            />
          }
        />
        <div className="p-4 grid grid-cols-2 gap-4" style={{ opacity: draft.secondBrain.enabled ? 1 : 0.5 }}>

          <div className="col-span-2">
            <div className="eyebrow mb-2">Global scope (shared across all projects)</div>
            <Field
              label="Global store directory"
              hint="Empty = ~/.hive/mem. Relative paths resolve from home."
              className="max-w-md"
            >
              {(id) => (
                <Input
                  id={id}
                  className="font-mono text-[12px]"
                  value={draft.secondBrain.globalDir}
                  onChange={(e) => setSecondBrain({ globalDir: e.target.value })}
                />
              )}
            </Field>
          </div>

          <div className="col-span-2">
            <div className="eyebrow mb-2 mt-4">Project scope (per-repo, checked into git)</div>
            <Field
              label="Project store directory"
              hint="Relative to repository root. Empty = disabled for this project."
              className="max-w-md"
            >
              {(id) => (
                <Input
                  id={id}
                  className="font-mono text-[12px]"
                  value={draft.secondBrain.dir}
                  onChange={(e) => setSecondBrain({ dir: e.target.value })}
                />
              )}
            </Field>
          </div>

        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Second Brain" title="Learning" />
        <div className="p-4 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">Learn from runs</span>
            <div className="flex items-center gap-2 h-9">
              <Switch
                checked={draft.secondBrain.learning.enabled}
                onChange={(v) => setLearning({ enabled: v })}
                label="Enabled"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">LLM model for synthesis</span>
            <div className="flex items-center gap-2 h-9">
              <HelpCircle className="size-4 text-faint" />
              <span className="text-[12px] text-muted">
                Empty = heuristics only. Use catalog id (e.g. opencode/anthropic/claude-3-5-sonnet).
              </span>
            </div>
          </div>

          <Field
            label="Model catalog id"
            hint="harness/provider/model — leave blank for heuristic-only mode"
            className="col-span-2 max-w-lg"
          >
            {(id) => (
              <Input
                id={id}
                className="font-mono text-[12px]"
                value={draft.secondBrain.learning.model}
                onChange={(e) => setLearning({ model: e.target.value })}
              />
            )}
          </Field>

          <Field
            label="Batch interval"
            hint="How often the periodic synthesis runs (ms). Default 6h."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={60000}
                step={60000}
                value={draft.secondBrain.learning.batchIntervalMs}
                onChange={(e) =>
                  setLearning({ batchIntervalMs: Math.max(60000, Number(e.target.value) || 60000) })
                }
              />
            )}
          </Field>

          <Field
            label="Min confidence"
            hint="Records below this are stored but never surfaced to agents (0–1)."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.secondBrain.learning.minConfidence}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(1, Number(e.target.value) || 0));
                  setLearning({ minConfidence: v });
                }}
              />
            )}
          </Field>

          <Field
            label="Max suggestions / batch"
            hint="Cap on soul.md suggestions queued per periodic run."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={20}
                value={draft.secondBrain.learning.maxSuggestionsPerBatch}
                onChange={(e) =>
                  setLearning({ maxSuggestionsPerBatch: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            )}
          </Field>

          <div className="col-span-2">
            <div className="eyebrow mb-2">Immediate triggers</div>
            <div className="grid grid-cols-2 gap-3">
              <Switch
                checked={draft.secondBrain.learning.triggers.onFailure}
                onChange={(v) => setTriggers({ onFailure: v })}
                label="On failure"
              />
              <Switch
                checked={draft.secondBrain.learning.triggers.onCorrection}
                onChange={(v) => setTriggers({ onCorrection: v })}
                label="On correction"
              />
              <Switch
                checked={draft.secondBrain.learning.triggers.onExplicitNote}
                onChange={(v) => setTriggers({ onExplicitNote: v })}
                label="On explicit note"
              />
              <Switch
                checked={draft.secondBrain.learning.triggers.periodic}
                onChange={(v) => setTriggers({ periodic: v })}
                label="Periodic (timer)"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Second Brain" title="Routing augmentation" />
        <div className="p-4 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">Augment keyword routing</span>
            <div className="flex items-center gap-2 h-9">
              <Switch
                checked={draft.secondBrain.routing.augment}
                onChange={(v) => setRouting({ augment: v })}
                label="Enabled"
              />
            </div>
          </div>

          <Field
            label="Min samples"
            hint="Learned routing needs this many observations before it speaks up."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={50}
                value={draft.secondBrain.routing.minSamples}
                onChange={(e) =>
                  setRouting({ minSamples: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            )}
          </Field>

          <Field
            label="Min margin"
            hint="Success-rate gap required before learned signal overrides a rule (0–1)."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.secondBrain.routing.minMargin}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(1, Number(e.target.value) || 0));
                  setRouting({ minMargin: v });
                }}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Second Brain" title="Retrieval limits" />
        <div className="p-4 grid grid-cols-2 gap-4">
          <Field
            label="Max preferences in briefing"
            hint="Cap on injected user preferences so they don't crowd the prompt."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={50}
                value={draft.secondBrain.retrieval.maxPreferences}
                onChange={(e) =>
                  setRetrieval({ maxPreferences: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            )}
          </Field>

          <Field
            label="Max lessons in briefing"
            hint="Cap on injected lessons from past tasks."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={50}
                value={draft.secondBrain.retrieval.maxLessons}
                onChange={(e) =>
                  setRetrieval({ maxLessons: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            )}
          </Field>

          <Field
            label="Max briefing chars"
            hint="Hard cap on the briefing text injected into the agent prompt."
            className="max-w-xs"
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={500}
                max={10000}
                step={100}
                value={draft.secondBrain.retrieval.maxBriefingChars}
                onChange={(e) =>
                  setRetrieval({ maxBriefingChars: Math.max(500, Number(e.target.value) || 500) })
                }
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Second Brain" title="soul.md" />
        <div className="p-4 flex flex-col gap-4">
          <p className="text-[13px] text-muted max-w-[62ch]">
            <code className="font-mono text-[12px] bg-muted px-1 rounded">soul.md</code> is the
            human-readable summary the learning agent builds from observed preferences and
            lessons. It lives in the active scope's directory. Edit it here to steer agent
            behaviour directly.
          </p>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink">soul.md content</span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={fetchSoul} disabled={soulLoading}>
                  {soulLoading ? "Loading…" : "Reload"}
                </Button>
                <Button size="sm" variant="primary" onClick={saveSoul} disabled={soulLoading}>
                  {soulLoading ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>

            {soulError && (
              <div className="px-3 py-2 rounded-md border border-danger bg-danger-soft text-[12px] text-danger">
                {soulError}
              </div>
            )}

            <Textarea
              value={soulContent}
              onChange={(e) => setSoulContent(e.target.value)}
              placeholder="soul.md will appear here after reload…"
              className="font-mono text-[12px] min-h-[280px] bg-surface border-line"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}