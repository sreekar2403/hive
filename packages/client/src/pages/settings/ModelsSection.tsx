import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  StatusDot,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { useModelCatalog } from "../../state/useModelCatalog";
import type { SettingsConfig } from "./types";

/**
 * What this machine can actually run, asked of each source in its own
 * language — `opencode models`, `pi --list-models`, Ollama's /api/tags,
 * LM Studio's /v1/models — rather than a list typed into config.
 *
 * A source that can't answer says why here (LM Studio not running, no
 * Anthropic key) instead of silently contributing nothing.
 */
export function ModelsSection({
  draft,
  onChange,
}: {
  draft: SettingsConfig;
  onChange: (updater: (prev: SettingsConfig) => SettingsConfig) => void;
}) {
  const { catalog, loading, error, refresh } = useModelCatalog();
  const [query, setQuery] = useState("");

  /**
   * Models that can actually look at an image.
   *
   * Only these are offered as the describer — the whole point of the
   * setting is choosing which of them reads a screenshot best, and a list
   * that included blind models would be a list of ways to get nothing back.
   */
  const visionModels = useMemo(
    () => catalog.options.filter((option) => option.vision === true),
    [catalog.options],
  );

  const vision = draft.vision ?? { model: "", always: false };
  const setVision = (patch: Partial<NonNullable<SettingsConfig["vision"]>>) =>
    onChange((prev) => ({
      ...prev,
      vision: { ...(prev.vision ?? { model: "", always: false }), ...patch },
    }));

  const sources = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.sources.map((source) => ({
      ...source,
      shown: needle
        ? source.models.filter((m) =>
            `${m.provider} ${m.model}`.toLowerCase().includes(needle),
          )
        : source.models,
    }));
  }, [catalog.sources, query]);

  const total = catalog.options.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter models…"
            className="h-8 pl-8 text-[12px]"
            aria-label="Filter models"
          />
        </div>
        <span className="text-[12px] text-faint" data-numeric>
          {total} runnable
        </span>
        <Button size="sm" onClick={() => void refresh(true)} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Rediscover
        </Button>
      </div>

      {error ? (
        <div className="px-3 py-2 rounded-md border border-danger bg-danger-soft text-[13px] text-danger">
          {error}
        </div>
      ) : null}

      {loading && total === 0 ? (
        <p className="text-[13px] text-muted">
          Asking each harness and local server what it can run…
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Reading attached images"
          eyebrow="Which model looks at a screenshot when the one running the task cannot"
        />
        <div className="px-3 pb-3 flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            Most local models are blind. When you attach an image to a task
            running on one of them, it is described in words by the model below
            and the description is passed to the agent doing the work — labelled
            as a description, so the agent does not answer as though it saw the
            image itself.
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">Describing model</span>
            <select
              value={vision.model}
              onChange={(e) => setVision({ model: e.target.value })}
              className="h-8 rounded-md border border-line bg-surface-2 px-2 text-[13px] text-ink"
            >
              <option value="">
                Choose for me (prefers the harness already in use)
              </option>
              {visionModels.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id}
                </option>
              ))}
            </select>
            {visionModels.length === 0 ? (
              <span className="text-[12px] text-warn">
                No model here reports image support. Pull a vision model (for
                example <code>llava</code> or <code>qwen2.5-vl</code>) and
                rediscover.
              </span>
            ) : null}
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={vision.always}
              onChange={(e) => setVision({ always: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-[13px] text-ink">
              Describe images even when the working model can see them
              <span className="block text-[12px] text-muted">
                Off by default: a model that can see the image itself gets more
                from it than from someone else's description of it.
              </span>
            </span>
          </label>
        </div>
      </Card>

      {sources.map((source) => (
        <Card key={source.id}>
          <CardHeader
            title={source.label}
            eyebrow={
              source.kind === "harness"
                ? "Models this harness can be pointed at"
                : "Local model server"
            }
            actions={
              <div className="flex items-center gap-2">
                <StatusDot tone={source.ok ? "ok" : "warn"} />
                <Badge tone={source.ok ? "neutral" : "warn"}>
                  {source.models.length} models
                </Badge>
              </div>
            }
          />

          {source.error ? (
            <div className="flex items-start gap-1.5 px-4 pb-3 text-[12px] text-muted">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-warn" />
              <span>{source.error}</span>
            </div>
          ) : null}

          {source.shown.length > 0 ? (
            <div className="px-4 pb-4">
              <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
                {source.shown.map((model) => (
                  <li
                    key={model.id}
                    className="flex items-baseline gap-2 font-mono text-[11px] min-w-0"
                  >
                    <span className="text-faint shrink-0">
                      {model.provider}/
                    </span>
                    <span className="text-ink truncate">{model.model}</span>
                    {model.contextLabel ? (
                      <span className="text-faint ml-auto shrink-0">
                        {model.contextLabel}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : source.models.length > 0 ? (
            <p className="px-4 pb-4 text-[12px] text-faint">
              Nothing here matches “{query}”.
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
