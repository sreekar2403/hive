import { Position, type Node, type NodeProps } from "@xyflow/react";
import { Bot } from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type { AgentTaskNodeData } from "../types";

export function AgentTaskNode({
  data,
  selected,
}: NodeProps<Node<AgentTaskNodeData, "agentTask">>) {
  return (
    <NodeShell
      icon={Bot}
      title={data.label}
      subtitle={`${data.harness}${data.model ? ` · ${data.model}` : ""}`}
      status={data.status}
      selected={selected}
      handles={[
        { type: "target", position: Position.Left, id: "in" },
        { type: "source", position: Position.Right, id: "out" },
      ]}
    >
      {data.prompt ? truncate(data.prompt, 72) : "No prompt set"}
    </NodeShell>
  );
}
