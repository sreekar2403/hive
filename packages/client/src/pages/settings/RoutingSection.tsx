import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, Plus, Route, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  Input,
  Select,
  Switch,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { useModelCatalog, type ModelOption } from "../../state/useModelCatalog";
import {
  HARNESS_IDS,
  HARNESS_LABELS,
  type RoutingRule,
  type SettingsConfig,
} from "./types";

/**
 * Task routing: which harness and model handle each kind of work. Order is
 * priority — the first rule whose pattern matches the prompt wins, and the
 * `default` rule catches everything else.
 *
 * Laid out one card per rule rather than as a table: six editable fields
 * per row truncate badly at any realistic window width.
 *
 * Three things here are answers to "how would somebody know that?", which
 * the earlier version left the user to work out on their own:
 *
 *   - the model was a free-text box whose placeholder said "harness
 *     default". Getting a real value into it meant knowing a CLI's exact
 *     model notation, and a typo produced no error here — just a task that
 *     failed later, at spawn time. It is now a list of what that harness
 *     can actually run, read from the same catalog the composer uses.
 *   - the harness list offered all twelve whether or not they were
 *     installed. Uninstalled ones are still listed, because a rule for a
 *     CLI you are about to install is legitimate, but they are now grouped
 *     and labelled instead of looking identical to working ones.
 *   - a pattern is a regular expression matched against the prompt, and
 *     nothing showed you what it did. The tester at the top runs the real
 *     matching order against a sentence you type.
 */
export function RoutingSection({
  draft,
  onChange,
}: {
  draft: SettingsConfig;
  onChange: (updater: (prev: SettingsConfig) => SettingsConfig) => void;
}) {
  const rules = draft.routing.rules;
  const { catalog } = useModelCatalog();
  const [probe, setProbe] = useState("");

  /**
   * Which harnesses answered when the catalog was built. A harness that is
   * not installed contributes no source, so this is "installed and
   * working" rather than "listed in config".
   */
  const available = useMemo(
    () =>
      new Set(
        catalog.sources
          .filter((s) => s.kind === "harness" && s.ok)
          .map((s) => s.id),
      ),
    [catalog.sources],
  );

  /** Models per harness, for the model picker. */
  const modelsByHarness = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const option of catalog.options) {
      const list = map.get(option.harness) ?? [];
      list.push(option);
      map.set(option.harness, list);
    }
    return map;
  }, [catalog.options]);

  /**
   * The rule a prompt would actually reach, by the server's own order:
   * first enabled rule whose pattern matches, else the default.
   * See Router.route in packages/server/src/router.ts.
   */
  const probeResult = useMemo(
    () => (probe.trim() ? ruleFor(probe, rules) : null),
    [probe, rules],
  );

  const setRules = (next: RoutingRule[]) =>
    onChange((prev) => ({
      ...prev,
      routing: { ...prev.routing, rules: next },
    }));

  const patch = (id: string, p: Partial<RoutingRule>) =>
    setRules(rules.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    setRules(next);
  };

  const add = () => {
    const defaults = rules.filter((r) => r.taskType === "default");
    const rest = rules.filter((r) => r.taskType !== "default");
    setRules([
      ...rest,
      {
        id: `rule_${Date.now().toString(36)}`,
        taskType: "new-rule",
        pattern: "",
        harness: HARNESS_IDS[0],
        model: "",
        reasoning: "",
        enabled: true,
      },
      ...defaults,
    ]);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted max-w-[62ch]">
        When you send a task, Hive reads your prompt and hands the work to the
        first rule that matches. Order is priority — move a rule up to give it
        first refusal. The{" "}
        <span className="font-mono text-[12px]">default</span> rule catches
        anything nothing else matched.
      </p>

      <Card>
        <CardHeader eyebrow="Try it" title="Which rule would a prompt reach?" />
        <div className="px-4 pb-4 flex flex-col gap-2">
          <Input
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            placeholder="Write a prompt, e.g. add a test for the parser"
            aria-label="Test prompt"
            className="h-9 text-[13px]"
          />
          {probe.trim() ? (
            probeResult ? (
              <div className="flex items-center gap-2 text-[13px]">
                <Eye className="size-3.5 text-accent" />
                <span className="text-muted">Goes to</span>
                <Badge tone="accent">{probeResult.taskType}</Badge>
                <span className="font-mono text-[12px] text-ink">
                  {HARNESS_LABELS[
                    probeResult.harness as (typeof HARNESS_IDS)[number]
                  ] ?? probeResult.harness}
                  {probeResult.model ? ` · ${probeResult.model}` : ""}
                </span>
              </div>
            ) : (
              <p className="text-[13px] text-warn">
                No rule matches, and there is no default rule — the preferred
                harness below would take it.
              </p>
            )
          ) : (
            <p className="text-[12px] text-faint">
              Matched in the order below, first hit wins — the same order the
              server uses.
            </p>
          )}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <div className="eyebrow">
          {rules.length} {rules.length === 1 ? "rule" : "rules"}, in priority
          order
        </div>
        <Button size="sm" onClick={add}>
          <Plus className="size-3.5" />
          Add rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Route />}
            title="No routing rules"
            description="Without a rule, every task goes to the preferred harness below."
            action={
              <Button variant="primary" onClick={add}>
                <Plus className="size-4" />
                Add rule
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rules.map((rule, i) => {
            const isDefault = rule.taskType === "default";
            return (
              <Card
                key={rule.id}
                className={cn(
                  "p-3.5 transition-opacity",
                  !rule.enabled && "opacity-55",
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Priority controls */}
                  <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                    <span
                      className="font-mono text-[10px] text-faint"
                      data-numeric
                    >
                      {isDefault ? "—" : i + 1}
                    </span>
                    <IconButton
                      size="sm"
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || isDefault}
                      aria-label={`Move ${rule.taskType} up`}
                    >
                      <ArrowUp className="size-3.5" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      onClick={() => move(i, 1)}
                      disabled={i >= rules.length - 1 || isDefault}
                      aria-label={`Move ${rule.taskType} down`}
                    >
                      <ArrowDown className="size-3.5" />
                    </IconButton>
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col gap-3">
                    {/* Identity row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-2">
                        <span className="eyebrow">Task type</span>
                        {isDefault ? (
                          <Badge tone="accent">default</Badge>
                        ) : (
                          <Input
                            className="h-8 w-36 text-[13px]"
                            value={rule.taskType}
                            onChange={(e) =>
                              patch(rule.id, { taskType: e.target.value })
                            }
                            aria-label="Task type"
                          />
                        )}
                      </label>

                      <div className="ml-auto flex items-center gap-2">
                        <Switch
                          checked={rule.enabled}
                          onChange={(v) => patch(rule.id, { enabled: v })}
                          label={`Enable the ${rule.taskType} rule`}
                          disabled={isDefault}
                        />
                        {!isDefault ? (
                          <IconButton
                            size="sm"
                            variant="danger"
                            onClick={() =>
                              setRules(rules.filter((r) => r.id !== rule.id))
                            }
                            aria-label={`Delete the ${rule.taskType} rule`}
                          >
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        ) : null}
                      </div>
                    </div>

                    {/* Match */}
                    <label className="flex flex-col gap-1">
                      <span className="eyebrow">
                        Matches prompts containing
                      </span>
                      {isDefault ? (
                        <span className="text-[13px] text-muted">
                          Everything the rules above didn't match.
                        </span>
                      ) : (
                        <>
                          <Input
                            className={cn(
                              "h-8 font-mono text-[12px]",
                              patternError(rule.pattern) && "border-danger",
                            )}
                            value={rule.pattern}
                            onChange={(e) =>
                              patch(rule.id, { pattern: e.target.value })
                            }
                            placeholder="test|spec|assert"
                            aria-label="Match pattern"
                          />
                          {patternError(rule.pattern) ? (
                            /* The server compiles this too; a rule that
                               cannot compile silently never matches. */
                            <span className="text-[11px] text-danger">
                              {patternError(rule.pattern)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-faint">
                              A regular expression, matched against the prompt.
                              Use <span className="font-mono">|</span> for
                              &ldquo;or&rdquo;.
                            </span>
                          )}
                        </>
                      )}
                    </label>

                    {/* Destination */}
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 min-w-0">
                        <span className="eyebrow">Harness</span>
                        <HarnessSelect
                          value={rule.harness}
                          available={available}
                          onChange={(harness) =>
                            // A model ref belongs to the harness that
                            // understands it, so keeping the old one across
                            // a change would send opencode a Claude alias.
                            patch(rule.id, { harness, model: "" })
                          }
                        />
                        {!available.has(rule.harness) ? (
                          <span className="text-[11px] text-warn">
                            Not installed — tasks matching this rule will fall
                            back.
                          </span>
                        ) : null}
                      </label>
                      <label className="flex flex-col gap-1 min-w-0">
                        <span className="eyebrow">Model</span>
                        <ModelSelect
                          value={rule.model}
                          models={modelsByHarness.get(rule.harness) ?? []}
                          harnessAvailable={available.has(rule.harness)}
                          onChange={(model) => patch(rule.id, { model })}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader eyebrow="Fallbacks" title="When routing can't decide" />
        <div className="p-4 grid grid-cols-2 gap-4 max-w-2xl">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">
              Preferred harness
            </span>
            <HarnessSelect
              value={draft.routing.default}
              available={available}
              onChange={(harness) =>
                onChange((prev) => ({
                  ...prev,
                  routing: { ...prev.routing, default: harness },
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">
              If that one is unavailable
            </span>
            <HarnessSelect
              value={draft.routing.fallback}
              available={available}
              onChange={(harness) =>
                onChange((prev) => ({
                  ...prev,
                  routing: { ...prev.routing, fallback: harness },
                }))
              }
            />
          </label>
        </div>
      </Card>
    </div>
  );
}

/**
 * Harnesses, with the installed ones kept apart from the rest.
 *
 * Uninstalled harnesses stay on the list rather than being hidden: writing
 * a rule for a CLI you are about to install is a reasonable thing to do,
 * and silently dropping the option makes it look broken. But they used to
 * be indistinguishable from working ones, so choosing a harness that could
 * never run was a mistake nothing warned you about until a task failed.
 */
function HarnessSelect({
  value,
  available,
  onChange,
}: {
  value: string;
  available: Set<string>;
  onChange: (harness: string) => void;
}) {
  const installed = HARNESS_IDS.filter((h) => available.has(h));
  const missing = HARNESS_IDS.filter((h) => !available.has(h));

  return (
    <Select
      className="h-8 text-[13px]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Harness"
    >
      {installed.length > 0 ? (
        <optgroup label="Installed">
          {installed.map((h) => (
            <option key={h} value={h}>
              {HARNESS_LABELS[h]}
            </option>
          ))}
        </optgroup>
      ) : null}
      {missing.length > 0 ? (
        <optgroup label="Not installed">
          {missing.map((h) => (
            <option key={h} value={h}>
              {HARNESS_LABELS[h]}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}

/**
 * The models a harness can actually be pointed at.
 *
 * This replaced a free-text box. Its placeholder said "harness default",
 * which told you neither what a real value looked like nor that a wrong one
 * would fail at spawn time rather than here.
 *
 * A value already in the config that the catalog does not know is kept and
 * marked, never dropped: the catalog is a live view of a machine that may
 * have LM Studio closed right now, and silently clearing a rule someone
 * wrote would be worse than showing them something unrecognised.
 */
function ModelSelect({
  value,
  models,
  harnessAvailable,
  onChange,
}: {
  value: string;
  models: ModelOption[];
  harnessAvailable: boolean;
  onChange: (model: string) => void;
}) {
  const known = models.some((m) => m.ref === value);

  return (
    <>
      <Select
        className="h-8 font-mono text-[12px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Model"
      >
        <option value="">Harness default</option>
        {value && !known ? (
          <option value={value}>{value} — not in the catalog</option>
        ) : null}
        {models.map((m) => (
          <option key={m.id} value={m.ref}>
            {m.provider}/{m.model}
            {m.vision === true ? " · vision" : ""}
            {m.contextLabel ? ` · ${m.contextLabel}` : ""}
          </option>
        ))}
      </Select>
      {models.length === 0 ? (
        <span className="text-[11px] text-faint">
          {harnessAvailable
            ? "This harness chooses its own model; there is nothing to pick."
            : "Install the harness to see what it can run."}
        </span>
      ) : null}
    </>
  );
}

/**
 * The rule a prompt reaches, in the server's own order.
 *
 * Mirrors Router.route in packages/server/src/router.ts: the first enabled,
 * non-default rule whose pattern matches wins, and the default catches the
 * rest. Exported so the ordering can be tested directly — a tester that
 * disagreed with the server would be worse than no tester.
 */
export function ruleFor(
  prompt: string,
  rules: RoutingRule[],
): RoutingRule | null {
  const text = prompt.trim();
  if (!text) return null;

  for (const rule of rules) {
    if (!rule.enabled || rule.taskType === "default") continue;
    if (!rule.pattern.trim()) continue;
    try {
      if (new RegExp(rule.pattern, "i").test(text)) return rule;
    } catch {
      // A pattern that cannot compile never matches, on the server too.
      // It is flagged on its own card rather than silently skipped here.
    }
  }
  return rules.find((r) => r.taskType === "default") ?? null;
}

/** Why a pattern will never match, when it cannot compile. */
export function patternError(pattern: string): string | null {
  if (!pattern.trim()) return null;
  try {
    new RegExp(pattern, "i");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Not a valid pattern";
  }
}
