import { Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { nodeDef } from "./nodeDefs";
import type {
  AgentTaskNodeData,
  ApprovalNodeData,
  GateNodeData,
  HiveNode,
  HiveNodeData,
  JoinNodeData,
  OutputNodeData,
  ParallelNodeData,
  ToolNodeData,
  TriggerNodeData,
} from "./types";

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

  const def = nodeDef(node.type as never);
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

function AgentTaskFields({
  data,
  set,
}: {
  data: AgentTaskNodeData;
  set: (patch: Partial<HiveNodeData>) => void;
}) {
  return (
    <>
      <Field label="Harness">
        {(id) => (
          <Select
            id={id}
            value={data.harness}
            onChange={(e) => set({ harness: e.target.value as never })}
          >
            <option value="opencode">opencode</option>
            <option value="claude-code">claude-code</option>
            <option value="pi">pi</option>
          </Select>
        )}
      </Field>
      <Field label="Model" hint="Leave blank to use the harness default.">
        {(id) => (
          <Input
            id={id}
            className="font-mono text-[12px]"
            value={data.model}
            onChange={(e) => set({ model: e.target.value })}
            placeholder="claude-sonnet-4"
          />
        )}
      </Field>
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
              onChange={(e) => set({ timeoutSec: Number(e.target.value) || 60 })}
            />
          )}
        </Field>
      </div>
    </>
  );
}
