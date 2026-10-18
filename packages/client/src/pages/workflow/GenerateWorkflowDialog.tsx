import { useEffect, useState } from "react";
import { Loader2, Sparkles, type LucideIcon } from "lucide-react";
import {
  Button,
  Field,
  Modal,
  Select,
  Textarea,
} from "../../components/ui";
import { HARNESS_IDS, HARNESS_LABELS } from "../settings/types";
import {
  deriveWorkflowName,
  generateWorkflow,
  type GeneratedGraph,
} from "./generateApi";
import { nodeDef } from "./nodeDefs";
import type { HiveNode } from "./types";

type Phase =
  | { name: "editing" }
  | { name: "generating"; startedAt: number }
  | { name: "preview"; graph: GeneratedGraph; elapsedMs: number }
  | { name: "error"; message: string; graph: GeneratedGraph | null };

/**
 * Indeterminate but honest: generation is one long model call, so the
 * stages describe what the server is doing while the elapsed clock proves
 * the request is alive. Rotates until the call resolves.
 */
const GENERATING_STAGES = [
  "Contacting harness…",
  "Drafting workflow…",
  "Validating graph…",
] as const;

/**
 * Describe-in-text → workflow graph, with preview-then-apply.
 *
 * Nothing touches the canvas until Apply: the dialog owns its phases and
 * hands the accepted graph to the caller, which records history first so
 * the whole generation is one undo step.
 */
export function GenerateWorkflowDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  /** Resolves when the graph is on the canvas; rejects to keep the dialog open with the error shown. */
  onApply: (graph: GeneratedGraph, suggestedName: string) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [harness, setHarness] = useState("");
  const [maxSteps, setMaxSteps] = useState(8);
  const [phase, setPhase] = useState<Phase>({ name: "editing" });
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  function reset() {
    setPhase({ name: "editing" });
    setApplyError(null);
  }

  async function apply(graph: GeneratedGraph) {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      await onApply(graph, deriveWorkflowName(description));
      reset();
      onClose();
    } catch (err) {
      setApplyError(
        err instanceof Error ? err.message : "Could not apply the workflow.",
      );
    } finally {
      setApplying(false);
    }
  }

  // Ticks the elapsed clock + stage rotation while a draft is in flight.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase.name !== "generating") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [phase.name]);

  async function run() {
    if (!description.trim() || phase.name === "generating") return;
    const startedAt = Date.now();
    setNow(startedAt);
    setPhase({ name: "generating", startedAt });
    try {
      const graph = await generateWorkflow({
        description: description.trim(),
        ...(harness ? { harness } : {}),
        maxNodes: maxSteps,
      });
      setPhase({ name: "preview", graph, elapsedMs: Date.now() - startedAt });
    } catch (err) {
      setPhase({
        name: "error",
        message: err instanceof Error ? err.message : "Generation failed.",
        graph: null,
      });
    }
  }

  const busy = phase.name === "generating";
  const preview =
    phase.name === "preview" ? phase.graph : (
      phase.name === "error" ? phase.graph : null
    );
  // Narrowed once here so JSX below never touches a missing field.
  const generatingLabel =
    phase.name === "generating"
      ? `${stageFor(now - phase.startedAt)} (${Math.floor((now - phase.startedAt) / 1000)}s)`
      : "Generate";

  function stageFor(elapsedMs: number): string {
    const idx = Math.floor(elapsedMs / 3500) % GENERATING_STAGES.length;
    return GENERATING_STAGES[idx];
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Generate workflow"
      description="Describe what you need. Review the preview, then apply — nothing changes until you do."
      width="lg"
      footer={
        phase.name === "preview" ? (
          <>
            <Button
              onClick={run}
              disabled={busy}
            >
              Regenerate
            </Button>
            <Button
              onClick={reset}
              disabled={busy}
            >
              Back
            </Button>
            <Button
              variant="primary"
              onClick={() => apply(phase.graph)}
              disabled={applying}
            >
              {applying ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {applying ? "Applying…" : "Apply to canvas"}
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={run}
              disabled={busy || !description.trim()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {generatingLabel}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What should this workflow do?" required>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Nightly sweep: read research notes, run tests in parallel, ask approval before writing files…"
              autoFocus
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run();
              }}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Harness preference">
            {(id) => (
              <Select
                id={id}
                value={harness}
                onChange={(e) => setHarness(e.target.value)}
                disabled={busy}
              >
                <option value="">Automatic</option>
                {HARNESS_IDS.map((h) => (
                  <option key={h} value={h}>
                    {HARNESS_LABELS[h]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Max steps">
            {(id) => (
              <Select
                id={id}
                value={String(maxSteps)}
                onChange={(e) => setMaxSteps(Number(e.target.value) || 8)}
                disabled={busy}
              >
                <option value="4">Up to 4 steps</option>
                <option value="8">Up to 8 steps</option>
                <option value="10">Up to 10 steps</option>
              </Select>
            )}
          </Field>
        </div>

        {phase.name === "error" ? (
          <p className="text-[13px] text-danger" role="alert">
            {phase.message}{" "}
            <button
              className="underline"
              onClick={run}
            >
              Try again
            </button>
          </p>
        ) : null}

        {phase.name === "generating" ? (
          <div
            className="border border-line rounded-lg overflow-hidden"
            aria-live="polite"
            aria-label="Generating workflow"
          >
            <div className="px-3 py-2 bg-surface-2 border-b border-line flex items-center gap-2">
              <Loader2
                className="size-3.5 animate-spin text-accent"
                aria-hidden="true"
              />
              <span className="text-[12px] font-medium text-ink">
                {generatingLabel}
              </span>
            </div>
            <div className="px-3 py-2.5 flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="size-6 rounded-md bg-surface-2 animate-pulse shrink-0" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div
                      className="h-3 rounded bg-surface-2 animate-pulse"
                      style={{ width: `${82 - i * 12}%` }}
                    />
                    <div
                      className="h-2.5 rounded bg-surface-2 animate-pulse"
                      style={{ width: `${64 - i * 8}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {preview ? (
          <div className="border border-line rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-surface-2 border-b border-line flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink">
                Preview — {preview.nodes.length} step
                {preview.nodes.length === 1 ? "" : "s"}
                {phase.name === "preview" && preview.draftedBy
                  ? ` · drafted by ${preview.draftedBy} in ${(phase.elapsedMs / 1000).toFixed(0)}s`
                  : null}
              </span>
              <span className="text-[11px] text-muted">
                Editable after Apply
              </span>
            </div>
            <ol className="px-3 py-2 flex flex-col gap-1.5 max-h-56 overflow-y-auto">
              {preview.nodes.map((n, i) => (
                <PreviewRow key={n.id} index={i} node={n} />
              ))}
            </ol>
            {preview.warnings.length > 0 ? (
              <ul className="px-3 py-2 border-t border-line flex flex-col gap-1">
                {preview.warnings.map((w, i) => (
                  <li key={i} className="text-[11px] text-warn">
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {applyError ? (
          <p className="text-[13px] text-danger" role="alert">
            {applyError}
          </p>
        ) : null}

        {phase.name === "editing" ? (
          <p className="text-[12px] text-muted">
            Tip: Ctrl+Enter generates. The canvas keeps its own undo, so
            Apply is always reversible.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function PreviewRow({ index, node }: { index: number; node: HiveNode }) {
  // Resolve everything throwing before returning JSX — React does not run
  // effects/render through try/catch, so JSX must stay out of the try block.
  let label: string = node.type;
  let summary = "";
  let Icon: LucideIcon | null = null;
  try {
    const def = nodeDef(node.type);
    label = def.label;
    Icon = def.icon;
    summary = summarize(node);
  } catch {
    // Unknown kind from a newer server: text-only row, still applicable.
  }
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <span className="font-mono text-[11px] text-muted mt-0.5 w-5 shrink-0">
        {index + 1}.
      </span>
      {Icon ? (
        <Icon
          className="size-3.5 mt-0.5 text-muted shrink-0"
          aria-hidden="true"
        />
      ) : null}
      <span className="min-w-0">
        <span className="font-medium text-ink">{node.data.label}</span>
        <span className="text-muted"> — {label}</span>
        {summary ? (
          <span className="block text-[12px] text-muted truncate">
            {summary}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function summarize(node: HiveNode): string {
  const data = node.data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (node.type) {
    case "agentTask":
    case "llmCall":
    case "reviewer":
      return [str(data.harness), str(data.prompt || data.rubric)]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 80);
    case "trigger":
      return str(data.triggerKind);
    case "fileWrite":
      return str(data.path);
    case "httpRequest":
    case "urlFetch":
      return str(data.url);
    case "webSearch":
    case "vectorSearch":
      return str(data.query);
    default:
      return (
        str(data.prompt) ||
        str(data.command) ||
        str(data.condition) ||
        str(data.message) ||
        ""
      ).slice(0, 80);
  }
}
