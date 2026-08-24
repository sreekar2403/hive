import { Position, type Node, type NodeProps } from "@xyflow/react";
import { Wrench } from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type { ToolNodeData } from "../types";

export function ToolNode({
  data,
  selected,
}: NodeProps<Node<ToolNodeData, "tool">>) {
  return (
    <NodeShell
      icon={Wrench}
      title={data.label}
      subtitle={data.toolKind}
      status={data.status}
      selected={selected}
      handles={[
        { type: "target", position: Position.Left, id: "in" },
        { type: "source", position: Position.Right, id: "out" },
      ]}
    >
      <span className="font-mono">
        {data.command ? truncate(data.command, 60) : "No command set"}
      </span>
    </NodeShell>
  );
}
