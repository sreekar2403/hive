import { useCallback, useEffect, useState } from "react";
import { Check, FolderOpen, Sparkles, TriangleAlert } from "lucide-react";
import { API } from "../lib/api";
import { Badge, Button, Modal, StatusDot, Switch } from "./ui";

/**
 * The one thing Hive asks before it starts working.
 *
 * Everything else about a machine is discoverable — which CLIs are on PATH,
 * which models they can run — and is discovered rather than asked. What
 * cannot be discovered is a preference: which model the user is willing to
 * spend on a routing decision that happens on *every* task. Guessing that
 * silently is how a tool ends up quietly expensive, so it is the question,
 * and it is asked once.
 *
 * The answer is written to soul.md rather than buried in config, because
 * that is where the user will go to change it, and where the Second Brain
 * will later add what it has learned alongside it.
 */

interface RouterCandidate {
  id: string;
  harness: string;
  model: string;
  label: string;
  note: string;
  recommended: boolean;
}

interface SetupResult {
  routerModel: string;
  enabled: string[];
  disabled: string[];
  soulPath: string;
  soulWritten: boolean;
}

interface SetupStatus {
  needed: boolean;
  reason: string;
  harnesses: Array<{
    id: string;
    label: string;
    command: string;
    installed: boolean;
    summary: string;
  }>;
  routerCandidates: RouterCandidate[];
  suggestedRoutes: Array<{ category: string; harness: string }>;
  soulPath: string;
  soulExists: boolean;
}

const AUTOMATIC = "__automatic__";

export function SetupDialog({ onDone }: { onDone?: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(AUTOMATIC);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What setup actually did.
   *
   * The dialog used to close on success and say nothing, which is
   * indistinguishable from it having failed — especially when the file it
   * wrote lives in `~/.hive/mem`, somewhere the user has no reason to look.
   * Setup writes a file and changes which agents are on; it should say so.
   */
  const [result, setResult] = useState<SetupResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await API.get<SetupStatus>("/api/setup");
        if (cancelled) return;
        setStatus(data);
        setOpen(data.needed);
        setEnabled(
          new Set(data.harnesses.filter((h) => h.installed).map((h) => h.id)),
        );
        const recommended = data.routerCandidates.find((c) => c.recommended);
        setChoice(recommended ? recommended.id : AUTOMATIC);
      } catch {
        // A server that cannot answer is not a reason to block the app —
        // setup will be offered again on the next load.
        if (!cancelled) setOpen(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(async () => {
    if (!status) return;
    setSaving(true);
    setError(null);
    try {
      const done = await API.post<SetupResult>("/api/setup", {
        routerModel: choice === AUTOMATIC ? "" : choice,
        enabledHarnesses: Array.from(enabled),
      });
      setResult(done);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup could not finish");
    } finally {
      setSaving(false);
    }
  }, [status, choice, enabled, onDone]);

  if (!status || !open) return null;

  const installed = status.harnesses.filter((h) => h.installed);
  const missing = status.harnesses.filter((h) => !h.installed);

  if (result) {
    return (
      <Modal
        open
        onClose={() => setOpen(false)}
        title="Hive is set up"
        width="lg"
        footer={
          <div className="flex items-center justify-end w-full">
            <Button size="sm" onClick={() => setOpen(false)}>
              Start working
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 text-[13px]">
          <p className="flex items-start gap-2">
            <Check className="size-4 shrink-0 mt-0.5 text-ok" />
            <span>
              {result.soulWritten
                ? "Your soul.md was created."
                : "You already had a soul.md, so it was left as it is."}{" "}
              It holds your routing preferences, and you can edit it any time.
            </span>
          </p>

          <div className="rounded-md border border-line p-3 flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <FolderOpen className="size-3.5" />
              soul.md
            </span>
            <code className="font-mono text-[12px] break-all">
              {result.soulPath}
            </code>
            <span className="text-[12px] text-muted">
              Open it in Hive under <strong>Memory → soul.md</strong>, or{" "}
              <strong>Settings → Second Brain</strong>.
            </span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <dt className="text-muted">Routing decided by</dt>
            <dd className="font-mono break-all">
              {result.routerModel || "a small model, chosen automatically"}
            </dd>

            <dt className="text-muted">Agents switched on</dt>
            <dd>{result.enabled.join(", ") || "none — install a CLI"}</dd>

            {result.disabled.length > 0 ? (
              <>
                <dt className="text-muted">Left off</dt>
                <dd className="text-muted">{result.disabled.join(", ")}</dd>
              </>
            ) : null}
          </dl>

          <p className="text-[12px] text-muted">
            From here Hive watches which agent finishes which kind of work and
            proposes additions to soul.md, which you approve on the Memory
            screen.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Set up Hive"
      width="lg"
      description="Hive found these agents on your machine. Pick the model that decides which one gets each task — you can change all of it later."
      footer={
        <div className="flex items-center justify-between w-full gap-3">
          <span className="text-[12px] text-muted truncate">
            Saved to {status.soulPath}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Skip for now
            </Button>
            <Button size="sm" onClick={finish} disabled={saving}>
              {saving ? "Setting up…" : "Finish setup"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? (
          <p className="flex items-start gap-2 text-[13px] text-danger">
            <TriangleAlert className="size-4 shrink-0 mt-0.5" />
            {error}
          </p>
        ) : null}

        {/* ---- the question ---- */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium flex items-center gap-1.5">
            <Sparkles className="size-3.5" />
            Which model should decide routing?
          </h3>
          <p className="text-[12px] text-muted max-w-[64ch]">
            This model reads each task and picks the agent for it. It runs on
            every task, so a small fast model is usually the right answer — the
            agent doing the actual work can still be your best one.
          </p>

          <div className="flex flex-col gap-1.5 mt-1">
            <RouterOption
              id={AUTOMATIC}
              label="Choose automatically"
              note="Hive picks the smallest capable model it can find, and falls back to keyword routing if there isn't one"
              selected={choice === AUTOMATIC}
              onSelect={setChoice}
            />
            {status.routerCandidates.map((candidate) => (
              <RouterOption
                key={candidate.id}
                id={candidate.id}
                label={candidate.label}
                note={candidate.note}
                recommended={candidate.recommended}
                selected={choice === candidate.id}
                onSelect={setChoice}
              />
            ))}
          </div>

          {status.routerCandidates.length === 0 ? (
            <p className="text-[12px] text-muted">
              No models could be listed yet. Hive will route by keyword until a
              CLI reports one.
            </p>
          ) : null}
        </section>

        {/* ---- what was found ---- */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium">
            Agents found ({installed.length})
          </h3>
          {installed.length === 0 ? (
            <p className="text-[12px] text-muted">
              None yet. Install a CLI — Claude Code, opencode, Codex, Gemini —
              and restart Hive.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {installed.map((harness) => (
                <label
                  key={harness.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13px]">
                      <StatusDot tone="ok" />
                      {harness.label}
                      <code className="text-[11px] text-muted">
                        {harness.command}
                      </code>
                    </span>
                    <span className="block text-[12px] text-muted truncate">
                      {harness.summary}
                    </span>
                  </span>
                  <Switch
                    checked={enabled.has(harness.id)}
                    onChange={(on) =>
                      setEnabled((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(harness.id);
                        else next.delete(harness.id);
                        return next;
                      })
                    }
                    label={`Use ${harness.label}`}
                  />
                </label>
              ))}
            </div>
          )}

          {missing.length > 0 ? (
            <p className="text-[12px] text-muted">
              Not installed, and left switched off:{" "}
              {missing.map((h) => h.label).join(", ")}.
            </p>
          ) : null}
        </section>

        {/* ---- what will be written ---- */}
        {status.suggestedRoutes.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium">Starting routes</h3>
            <p className="text-[12px] text-muted max-w-[64ch]">
              A starting point written into your soul.md. Anything not listed is
              decided by the model above; edit or delete any line to change
              that.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {status.suggestedRoutes.map((route) => (
                <Badge key={route.category}>
                  {route.category} → {route.harness}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function RouterOption({
  id,
  label,
  note,
  recommended,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  note: string;
  recommended?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${
        selected
          ? "border-accent bg-accent-soft"
          : "border-line hover:border-line-strong"
      }`}
    >
      <span
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
          selected ? "border-accent bg-accent text-accent-fg" : "border-line"
        }`}
      >
        {selected ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[13px]">
          {label}
          {recommended ? <Badge>Recommended</Badge> : null}
        </span>
        <span className="block text-[12px] text-muted">{note}</span>
      </span>
    </button>
  );
}
