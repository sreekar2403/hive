import { useMemo } from "react";
import { Boxes, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { useModelCatalog } from "../../state/useModelCatalog";
import { HARNESS_IDS, HARNESS_LABELS } from "../settings/types";
import { nodeDef } from "./nodeDefs";
import type {
  AgentTaskNodeData,
  ApprovalNodeData,
  ChatInputNodeData,
  ChatOutputNodeData,
  DelayNodeData,
  FileReadNodeData,
  FileWriteNodeData,
  GateNodeData,
  HiveNode,
  HiveNodeData,
  HttpRequestNodeData,
  JsonParseNodeData,
  JoinNodeData,
  LlmCallNodeData,
  LoopNodeData,
  NoteNodeData,
  NotifyNodeData,
  OutputNodeData,
  ParallelNodeData,
  PromptTemplateNodeData,
  ReviewerNodeData,
  SetVariableNodeData,
  StructuredOutputNodeData,
  SubflowNodeData,
  ToolNodeData,
  TransformNodeData,
  TriggerNodeData,
  UrlFetchNodeData,
  VectorSearchNodeData,
  WebSearchNodeData,
} from "./types";

/**
 * Unknown kinds (saved by a newer client, or hand-edited) must not take the
 * inspector down — validation already warns about them, so here we show the
 * name field plus a note instead of crashing on nodeDef().
 */
function safeNodeDef(kind: string) {
  try {
    return nodeDef(kind as never);
  } catch {
    return { label: kind, icon: Boxes };
  }
}

/**
 * Edits the selected node's configuration. Every field writes straight
 * through to node.data so the canvas and the inspector never disagree.
 */
export function Inspector({
  node,
  onChange,
  onDelete,
}: {
  node: HiveNode | null;
  onChange: (id: string, patch: Partial<HiveNodeData>) => void;
  onDelete: (id: string) => void;
}) {
  if (!node) {
    return (
      <div className="p-4">
        <div className="eyebrow mb-2">Inspector</div>
        <p className="text-[13px] text-muted">
          Select a step to edit what it does.
        </p>
      </div>
    );
  }

  const def = safeNodeDef(node.type);
  const Icon = def.icon;
  const set = (patch: Partial<HiveNodeData>) => onChange(node.id, patch);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 text-accent shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="eyebrow">{def.label}</div>
            <div className="text-sm font-semibold text-ink truncate">
              {node.data.label}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="danger"
          onClick={() => onDelete(node.id)}
          aria-label="Delete step"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={node.data.label}
              onChange={(e) => set({ label: e.target.value })}
            />
          )}
        </Field>

        {node.type === "trigger" ? (
          <TriggerFields data={node.data as TriggerNodeData} set={set} />
        ) : null}
        {node.type === "agentTask" ? (
          <AgentTaskFields data={node.data as AgentTaskNodeData} set={set} />
        ) : null}
        {node.type === "gate" ? (
          <Field
            label="Condition"
            hint="Evaluated after the previous step. True follows the top branch."
          >
            {(id) => (
              <Input
                id={id}
                className="font-mono text-[12px]"
                value={(node.data as GateNodeData).condition}
                onChange={(e) => set({ condition: e.target.value })}
                placeholder="result.filesChanged > 0"
              />
            )}
          </Field>
        ) : null}
        {node.type === "parallel" ? (
          <Field label="Branches" hint="How many copies run at once.">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={2}
                max={8}
                value={(node.data as ParallelNodeData).branches}
                onChange={(e) =>
                  set({ branches: Math.max(2, Number(e.target.value) || 2) })
                }
              />
            )}
          </Field>
        ) : null}
        {node.type === "join" ? (
          <Field label="Wait for" hint="When the join lets the flow continue.">
            {(id) => (
              <Select
                id={id}
                value={(node.data as JoinNodeData).waitPolicy}
                onChange={(e) => set({ waitPolicy: e.target.value as never })}
              >
                <option value="all">All branches</option>
                <option value="any">Any branch</option>
                <option value="first">First to finish</option>
              </Select>
            )}
          </Field>
        ) : null}
        {node.type === "approval" ? (
          <>
            <Field label="Approver" hint="Who is asked to sign off.">
              {(id) => (
                <Input
                  id={id}
                  value={(node.data as ApprovalNodeData).approver}
                  onChange={(e) => set({ approver: e.target.value })}
                  placeholder="you@example.com"
                />
              )}
            </Field>
            <Field label="What to check">
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  value={(node.data as ApprovalNodeData).instructions}
                  onChange={(e) => set({ instructions: e.target.value })}
                />
              )}
            </Field>
          </>
        ) : null}
        {node.type === "tool" ? (
          <>
            <Field label="Tool">
              {(id) => (
                <Select
                  id={id}
                  value={(node.data as ToolNodeData).toolKind}
                  onChange={(e) => set({ toolKind: e.target.value as never })}
                >
                  <option value="shell">Shell command</option>
                  <option value="git">Git</option>
                  <option value="http">HTTP request</option>
                </Select>
              )}
            </Field>
            <Field label="Command">
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  className="font-mono text-[12px]"
                  value={(node.data as ToolNodeData).command}
                  onChange={(e) => set({ command: e.target.value })}
                  placeholder="npm test"
                />
              )}
            </Field>
          </>
        ) : null}
        {node.type === "output" ? (
          <Field label="Result key" hint="Where the final value is stored.">
            {(id) => (
              <Input
                id={id}
                className="font-mono text-[12px]"
                value={(node.data as OutputNodeData).resultKey}
                onChange={(e) => set({ resultKey: e.target.value })}
              />
            )}
          </Field>
        ) : null}
        {node.type === "loop" ? (
          <LoopFields data={node.data as LoopNodeData} set={set} />
        ) : null}
        {node.type === "delay" ? (
          <DelayFields data={node.data as DelayNodeData} set={set} />
        ) : null}
        {node.type === "subflow" ? (
          <SubflowFields data={node.data as SubflowNodeData} set={set} />
        ) : null}
        {node.type === "reviewer" ? (
          <ReviewerFields data={node.data as ReviewerNodeData} set={set} />
        ) : null}
        {node.type === "chatInput" ? (
          <ChatInputFields data={node.data as ChatInputNodeData} set={set} />
        ) : null}
        {node.type === "chatOutput" ? (
          <ChatOutputFields data={node.data as ChatOutputNodeData} set={set} />
        ) : null}
        {node.type === "promptTemplate" ? (
          <PromptTemplateFields
            data={node.data as PromptTemplateNodeData}
            set={set}
          />
        ) : null}
        {node.type === "llmCall" ? (
          <LlmCallFields data={node.data as LlmCallNodeData} set={set} />
        ) : null}
        {node.type === "structuredOutput" ? (
          <StructuredOutputFields
            data={node.data as StructuredOutputNodeData}
            set={set}
          />
        ) : null}
        {node.type === "note" ? (
          <NoteFields data={node.data as NoteNodeData} set={set} />
        ) : null}
        {node.type === "fileRead" ? (
          <FileReadFields data={node.data as FileReadNodeData} set={set} />
        ) : null}
        {node.type === "fileWrite" ? (
          <FileWriteFields data={node.data as FileWriteNodeData} set={set} />
        ) : null}
        {node.type === "transform" ? (
          <TransformFields data={node.data as TransformNodeData} set={set} />
        ) : null}
        {node.type === "setVariable" ? (
          <SetVariableFields
            data={node.data as SetVariableNodeData}
            set={set}
          />
        ) : null}
        {node.type === "jsonParse" ? (
          <JsonParseFields data={node.data as JsonParseNodeData} set={set} />
        ) : null}
        {node.type === "httpRequest" ? (
          <HttpRequestFields
            data={node.data as HttpRequestNodeData}
            set={set}
          />
        ) : null}
        {node.type === "webSearch" ? (
          <WebSearchFields data={node.data as WebSearchNodeData} set={set} />
        ) : null}
        {node.type === "urlFetch" ? (
          <UrlFetchFields data={node.data as UrlFetchNodeData} set={set} />
        ) : null}
        {node.type === "notify" ? (
          <NotifyFields data={node.data as NotifyNodeData} set={set} />
        ) : null}
        {node.type === "vectorSearch" ? (
          <VectorSearchFields
            data={node.data as VectorSearchNodeData}
            set={set}
          />
        ) : null}
      </div>
    </div>
  );
}

function TriggerFields({
  data,
  set,
}: {
  data: TriggerNodeData;
  set: (patch: Partial<HiveNodeData>) => void;
}) {
  return (
    <>
      <Field label="Starts on">
        {(id) => (
          <Select
            id={id}
            value={data.triggerKind}
            onChange={(e) => set({ triggerKind: e.target.value as never })}
          >
            <option value="manual">Manual run</option>
            <option value="cron">A schedule</option>
            <option value="webhook">A webhook</option>
            <option value="file-change">A file change</option>
          </Select>
        )}
      </Field>
      {data.triggerKind === "cron" ? (
        <Field label="Schedule" hint="Standard cron expression.">
          {(id) => (
            <Input
              id={id}
              className="font-mono text-[12px]"
              value={data.cron ?? ""}
              onChange={(e) => set({ cron: e.target.value })}
              placeholder="0 9 * * 1-5"
            />
          )}
        </Field>
      ) : null}
      {data.triggerKind === "webhook" ? (
        <Field label="Path">
          {(id) => (
            <Input
              id={id}
              className="font-mono text-[12px]"
              value={data.webhookPath ?? ""}
              onChange={(e) => set({ webhookPath: e.target.value })}
              placeholder="/hooks/deploy"
            />
          )}
        </Field>
      ) : null}
      {data.triggerKind === "file-change" ? (
        <Field label="Watch pattern">
          {(id) => (
            <Input
              id={id}
              className="font-mono text-[12px]"
              value={data.filePattern ?? ""}
              onChange={(e) => set({ filePattern: e.target.value })}
              placeholder="src/**/*.ts"
            />
          )}
        </Field>
      ) : null}
    </>
  );
}

/**
 * Catalog-driven harness + model pickers shared by every node that points a
 * harness at a model (agent tasks, reviewers, bare LLM calls). One code path
 * so a fix here fixes all three — the free-text model box this replaced is
 * not coming back.
 */
function HarnessModelFields({
  harness,
  model,
  onHarness,
  onModel,
}: {
  harness: string;
  model: string;
  onHarness: (harness: string) => void;
  onModel: (model: string) => void;
}) {
  const { catalog, loading } = useModelCatalog();

  const available = useMemo(
    () =>
      new Set(
        catalog.sources
          .filter((s) => s.kind === "harness" && s.ok)
          .map((s) => s.id),
      ),
    [catalog.sources],
  );
  const models = useMemo(
    () => catalog.options.filter((m) => m.harness === harness),
    [catalog.options, harness],
  );
  const byProvider = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of models) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return [...map.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((p) => [p, map.get(p) ?? []] as const);
  }, [models]);
  const knownModel = !model || models.some((m) => m.ref === model);
  const installed = HARNESS_IDS.filter((h) => available.has(h));
  const missing = HARNESS_IDS.filter((h) => !available.has(h));

  return (
    <>
      <Field label="Harness">
        {(id) => (
          <Select
            id={id}
            value={harness}
            onChange={(e) =>
              // A model ref belongs to the harness that understands it, so
              // keeping the old one across a change would send e.g. opencode
              // a Claude alias that fails at spawn time.
              onHarness(e.target.value)
            }
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
            {/* Catalog hasn't loaded yet — still offer the saved value so
                the select never renders blank. */}
            {installed.length === 0 && missing.length === 0 ? (
              <option value={harness}>{harness}</option>
            ) : null}
          </Select>
        )}
      </Field>
      {!available.has(harness) && !loading ? (
        <p className="-mt-2 text-[11px] text-warn">
          Not installed — this step will fall back at run time.
        </p>
      ) : null}
      <Field
        label="Model"
        hint={
          models.length === 0 && !loading
            ? available.has(harness)
              ? "This harness chooses its own model; there is nothing to pick."
              : "Install the harness to see what it can run."
            : "Leave blank to use the harness default."
        }
      >
        {(id) => (
          <Select
            id={id}
            className="font-mono text-[12px]"
            value={model}
            disabled={loading}
            onChange={(e) => onModel(e.target.value)}
          >
            <option value="">
              {loading ? "Loading models…" : "Harness default"}
            </option>
            {model && !knownModel ? (
              <option value={model}>{model} — not in the catalog</option>
            ) : null}
            {byProvider.map(([provider, options]) => (
              <optgroup key={provider} label={provider}>
                {options.map((m) => (
                  <option key={m.id} value={m.ref}>
                    {m.model}
                    {m.contextLabel ? ` · ${m.contextLabel}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

function AgentTaskFields({
  data,
  set,
}: {
  data: AgentTaskNodeData;
  set: (patch: Partial<HiveNodeData>) => void;
}) {
  return (
    <>
      <HarnessModelFields
        harness={data.harness}
        model={data.model}
        onHarness={(harness) => set({ harness: harness as never, model: "" })}
        onModel={(model) => set({ model })}
      />
      <Field label="Prompt">
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            value={data.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            placeholder="Describe the work this step should do."
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Retries">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={10}
              value={data.retries}
              onChange={(e) => set({ retries: Number(e.target.value) || 0 })}
            />
          )}
        </Field>
        <Field label="Timeout (s)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={10}
              step={10}
              value={data.timeoutSec}
              onChange={(e) =>
                set({ timeoutSec: Number(e.target.value) || 60 })
              }
            />
          )}
        </Field>
      </div>
    </>
  );
}

type FieldSet<T> = {
  data: T;
  set: (patch: Partial<HiveNodeData>) => void;
};

function LoopFields({ data, set }: FieldSet<LoopNodeData>) {
  return (
    <>
      <Field
        label="Items"
        hint="One per line, or a JSON array expression."
      >
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            className="font-mono text-[12px]"
            value={data.items}
            onChange={(e) => set({ items: e.target.value })}
            placeholder='["a", "b"]'
          />
        )}
      </Field>
      <Field label="Max iterations">
        {(id) => (
          <Input
            id={id}
            type="number"
            min={1}
            max={100}
            value={data.maxIterations}
            onChange={(e) =>
              set({ maxIterations: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        )}
      </Field>
    </>
  );
}

function DelayFields({ data, set }: FieldSet<DelayNodeData>) {
  return (
    <>
      <Field label="Wait (seconds)">
        {(id) => (
          <Input
            id={id}
            type="number"
            min={0}
            step={5}
            value={data.waitSec}
            onChange={(e) => set({ waitSec: Math.max(0, Number(e.target.value) || 0) })}
          />
        )}
      </Field>
      <Field label="Wait for" hint="Optional signal name. Blank means a fixed delay.">
        {(id) => (
          <Input
            id={id}
            value={data.waitFor}
            onChange={(e) => set({ waitFor: e.target.value })}
            placeholder="approval-granted"
          />
        )}
      </Field>
    </>
  );
}

function SubflowFields({ data, set }: FieldSet<SubflowNodeData>) {
  return (
    <>
      <Field label="Workflow" hint="Name of the workflow to call.">
        {(id) => (
          <Input
            id={id}
            value={data.workflowName}
            onChange={(e) => set({ workflowName: e.target.value })}
            placeholder="Nightly test sweep"
          />
        )}
      </Field>
      <Field label="Input" hint="JSON passed to the sub-workflow.">
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            className="font-mono text-[12px]"
            value={data.input}
            onChange={(e) => set({ input: e.target.value })}
            placeholder='{"branch": "main"}'
          />
        )}
      </Field>
    </>
  );
}

function ReviewerFields({ data, set }: FieldSet<ReviewerNodeData>) {
  return (
    <>
      <HarnessModelFields
        harness={data.harness}
        model={data.model}
        onHarness={(harness) => set({ harness, model: "" })}
        onModel={(model) => set({ model })}
      />
      <Field label="Rubric" hint="What the judge checks in the previous result.">
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            value={data.rubric}
            onChange={(e) => set({ rubric: e.target.value })}
            placeholder="No placeholders, no TODOs, tests named after behavior…"
          />
        )}
      </Field>
    </>
  );
}

function ChatInputFields({ data, set }: FieldSet<ChatInputNodeData>) {
  return (
    <Field label="Placeholder">
      {(id) => (
        <Input
          id={id}
          value={data.placeholder}
          onChange={(e) => set({ placeholder: e.target.value })}
          placeholder="Ask me anything…"
        />
      )}
    </Field>
  );
}

function ChatOutputFields({ data, set }: FieldSet<ChatOutputNodeData>) {
  return (
    <Field label="Message" hint="Supports {{variables}} from earlier steps.">
      {(id) => (
        <Textarea
          id={id}
          rows={4}
          value={data.message}
          onChange={(e) => set({ message: e.target.value })}
          placeholder="Done — {{summary}}"
        />
      )}
    </Field>
  );
}

function PromptTemplateFields({
  data,
  set,
}: FieldSet<PromptTemplateNodeData>) {
  return (
    <Field label="Template" hint="Variables in {{braces}} become inputs.">
      {(id) => (
        <Textarea
          id={id}
          rows={5}
          className="font-mono text-[12px]"
          value={data.template}
          onChange={(e) => set({ template: e.target.value })}
          placeholder="Summarize {{topic}} for a {{audience}} audience."
        />
      )}
    </Field>
  );
}

function LlmCallFields({ data, set }: FieldSet<LlmCallNodeData>) {
  return (
    <>
      <HarnessModelFields
        harness={data.harness}
        model={data.model}
        onHarness={(harness) => set({ harness, model: "" })}
        onModel={(model) => set({ model })}
      />
      <Field label="Prompt">
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            value={data.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            placeholder="Answer directly, no repo access needed."
          />
        )}
      </Field>
    </>
  );
}

function StructuredOutputFields({
  data,
  set,
}: FieldSet<StructuredOutputNodeData>) {
  return (
    <Field label="Schema" hint="JSON Schema the model must satisfy.">
      {(id) => (
        <Textarea
          id={id}
          rows={5}
          className="font-mono text-[12px]"
          value={data.schema}
          onChange={(e) => set({ schema: e.target.value })}
          placeholder='{"type": "object", "properties": {"summary": {"type": "string"}}}'
        />
      )}
    </Field>
  );
}

function NoteFields({ data, set }: FieldSet<NoteNodeData>) {
  return (
    <Field label="Text">
      {(id) => (
        <Textarea
          id={id}
          rows={3}
          value={data.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Why does this branch exist?"
        />
      )}
    </Field>
  );
}

function FileReadFields({ data, set }: FieldSet<FileReadNodeData>) {
  return (
    <Field label="Pattern" hint="File path or glob to load.">
      {(id) => (
        <Input
          id={id}
          className="font-mono text-[12px]"
          value={data.pattern}
          onChange={(e) => set({ pattern: e.target.value })}
          placeholder="research/**/*.md"
        />
      )}
    </Field>
  );
}

function FileWriteFields({ data, set }: FieldSet<FileWriteNodeData>) {
  return (
    <>
      <Field label="Path">
        {(id) => (
          <Input
            id={id}
            className="font-mono text-[12px]"
            value={data.path}
            onChange={(e) => set({ path: e.target.value })}
            placeholder="report.md"
          />
        )}
      </Field>
      <Field label="Content" hint="Supports {{variables}} from earlier steps.">
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            className="font-mono text-[12px]"
            value={data.content}
            onChange={(e) => set({ content: e.target.value })}
            placeholder="# Report&#10;&#10;{{summary}}"
          />
        )}
      </Field>
    </>
  );
}

function TransformFields({ data, set }: FieldSet<TransformNodeData>) {
  return (
    <Field label="Expression" hint="JS expression over step results.">
      {(id) => (
        <Textarea
          id={id}
          rows={3}
          className="font-mono text-[12px]"
          value={data.expression}
          onChange={(e) => set({ expression: e.target.value })}
          placeholder="steps.tests.files.join('\n')"
        />
      )}
    </Field>
  );
}

function SetVariableFields({ data, set }: FieldSet<SetVariableNodeData>) {
  return (
    <>
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            className="font-mono text-[12px]"
            value={data.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="reportPath"
          />
        )}
      </Field>
      <Field label="Value">
        {(id) => (
          <Input
            id={id}
            className="font-mono text-[12px]"
            value={data.value}
            onChange={(e) => set({ value: e.target.value })}
            placeholder="report.md"
          />
        )}
      </Field>
    </>
  );
}

function JsonParseFields({ data, set }: FieldSet<JsonParseNodeData>) {
  return (
    <>
      <Field label="Source" hint="Step output holding JSON text.">
        {(id) => (
          <Input
            id={id}
            className="font-mono text-[12px]"
            value={data.source}
            onChange={(e) => set({ source: e.target.value })}
            placeholder="{{llmCall1}}"
          />
        )}
      </Field>
      <Field label="Path" hint="Dot path, blank means the whole document.">
        {(id) => (
          <Input
            id={id}
            className="font-mono text-[12px]"
            value={data.path}
            onChange={(e) => set({ path: e.target.value })}
            placeholder="summary"
          />
        )}
      </Field>
    </>
  );
}

function HttpRequestFields({ data, set }: FieldSet<HttpRequestNodeData>) {
  return (
    <>
      <Field label="Method">
        {(id) => (
          <Select
            id={id}
            value={data.method}
            onChange={(e) => set({ method: e.target.value })}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </Select>
        )}
      </Field>
      <Field label="URL">
        {(id) => (
          <Input
            id={id}
            className="font-mono text-[12px]"
            value={data.url}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://api.example.com/v1/items"
          />
        )}
      </Field>
      <Field label="Body" hint="Sent for POST/PUT/PATCH.">
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            className="font-mono text-[12px]"
            value={data.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder='{"q": "{{query}}"}'
          />
        )}
      </Field>
    </>
  );
}

function WebSearchFields({ data, set }: FieldSet<WebSearchNodeData>) {
  return (
    <>
      <Field label="Query">
        {(id) => (
          <Input
            id={id}
            value={data.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="latest research on local LLM observability"
          />
        )}
      </Field>
      <Field label="Max results">
        {(id) => (
          <Input
            id={id}
            type="number"
            min={1}
            max={20}
            value={data.maxResults}
            onChange={(e) =>
              set({ maxResults: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        )}
      </Field>
    </>
  );
}

function UrlFetchFields({ data, set }: FieldSet<UrlFetchNodeData>) {
  return (
    <Field label="URL">
      {(id) => (
        <Input
          id={id}
          className="font-mono text-[12px]"
          value={data.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="https://example.com/research-notes"
        />
      )}
    </Field>
  );
}

function NotifyFields({ data, set }: FieldSet<NotifyNodeData>) {
  return (
    <>
      <Field label="Channel" hint="Slack channel, email, or webhook URL.">
        {(id) => (
          <Input
            id={id}
            value={data.channel}
            onChange={(e) => set({ channel: e.target.value })}
            placeholder="#nightly-reports"
          />
        )}
      </Field>
      <Field label="Message">
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={data.message}
            onChange={(e) => set({ message: e.target.value })}
            placeholder="Sweep finished: {{summary}}"
          />
        )}
      </Field>
    </>
  );
}

function VectorSearchFields({
  data,
  set,
}: FieldSet<VectorSearchNodeData>) {
  return (
    <>
      <Field label="Query" hint="Searched against Second Brain memory.">
        {(id) => (
          <Input
            id={id}
            value={data.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="What did we learn about flaky tests?"
          />
        )}
      </Field>
      <Field label="Max results">
        {(id) => (
          <Input
            id={id}
            type="number"
            min={1}
            max={20}
            value={data.maxResults}
            onChange={(e) =>
              set({ maxResults: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        )}
      </Field>
    </>
  );
}
