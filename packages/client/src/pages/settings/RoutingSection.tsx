import { ArrowDown, ArrowUp, Plus, Route, Trash2 } from "lucide-react";
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
import {
  HARNESS_IDS,
  HARNESS_LABELS,
  type RoutingRule,
  type SettingsConfig,
} from "./types";

/**
 * Task routing: which harness, model and provider handle each kind of
 * work. Order is priority — the first rule whose pattern matches the
 * prompt wins, and the `default` rule catches everything else.
 *
 * Laid out one card per rule rather than as a table: six editable fields
 * per row truncate badly at any realistic window width.
 */
export function RoutingSection({
  draft,
  onChange,
}: {
  draft: SettingsConfig;
  onChange: (updater: (prev: SettingsConfig) => SettingsConfig) => void;
}) {
  const rules = draft.routing.rules;

  const setRules = (next: RoutingRule[]) =>
    onChange((prev) => ({ ...prev, routing: { ...prev.routing, rules: next } }));

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
        first refusal. The <span className="font-mono text-[12px]">default</span>{" "}
        rule catches anything nothing else matched.
      </p>

      <div className="flex items-center justify-between">
        <div className="eyebrow">
          {rules.length} {rules.length === 1 ? "rule" : "rules"}, in priority order
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
                    <span className="font-mono text-[10px] text-faint" data-numeric>
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
                      <span className="eyebrow">Matches prompts containing</span>
                      {isDefault ? (
                        <span className="text-[13px] text-muted">
                          Everything the rules above didn't match.
                        </span>
                      ) : (
                        <Input
                          className="h-8 font-mono text-[12px]"
                          value={rule.pattern}
                          onChange={(e) => patch(rule.id, { pattern: e.target.value })}
                          placeholder="test|spec|assert"
                          aria-label="Match pattern"
                        />
                      )}
                    </label>

                    {/* Destination */}
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 min-w-0">
                        <span className="eyebrow">Harness</span>
                        <Select
                          className="h-8 text-[13px]"
                          value={rule.harness}
                          onChange={(e) => patch(rule.id, { harness: e.target.value })}
                          aria-label="Harness"
                        >
                          {HARNESS_IDS.map((h) => (
                            <option key={h} value={h}>
                              {HARNESS_LABELS[h]}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1 min-w-0">
                        <span className="eyebrow">Model</span>
                        <Input
                          className="h-8 font-mono text-[12px]"
                          value={rule.model}
                          onChange={(e) => patch(rule.id, { model: e.target.value })}
                          placeholder="harness default"
                          aria-label="Model"
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
            <span className="text-[12px] font-medium text-ink">Preferred harness</span>
            <Select
              value={draft.routing.default}
              onChange={(e) =>
                onChange((prev) => ({
                  ...prev,
                  routing: { ...prev.routing, default: e.target.value },
                }))
              }
            >
              {HARNESS_IDS.map((h) => (
                <option key={h} value={h}>
                  {HARNESS_LABELS[h]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">
              If that one is unavailable
            </span>
            <Select
              value={draft.routing.fallback}
              onChange={(e) =>
                onChange((prev) => ({
                  ...prev,
                  routing: { ...prev.routing, fallback: e.target.value },
                }))
              }
            >
              {HARNESS_IDS.map((h) => (
                <option key={h} value={h}>
                  {HARNESS_LABELS[h]}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>
    </div>
  );
}
