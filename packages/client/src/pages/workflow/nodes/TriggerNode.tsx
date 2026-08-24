import { Position, type Node, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { NodeShell } from "./NodeShell";
import type { TriggerNodeData } from "../types";

const TRIGGER_LABEL: Record<TriggerNodeData["triggerKind"], string> = {
  manual: "Manual",
  cron: "Cron schedule",
  webhook: "Webhook",
  "file-change": "File change",
};

export function TriggerNode({
  data,
  selected,
}: NodeProps<Node<TriggerNodeData, "trigger">>) {
  const detail =
    data.triggerKind === "cron"
      ? data.cron || "No schedule set"
      : data.triggerKind === "webhook"
        ? data.webhookPath || "No path set"
        : data.triggerKind === "file-change"
          ? data.filePattern || "No pattern set"
          : undefined;

  return (
    <NodeShell
      icon={Zap}
      title={data.label}
      subtitle={TRIGGER_LABEL[data.triggerKind]}
      status={data.status}
      selected={selected}
      handles={[{ type: "source", position: Position.Right, id: "out" }]}
    >
      {detail ? <span className="font-mono">{detail}</span> : null}
    </NodeShell>
  );
}
