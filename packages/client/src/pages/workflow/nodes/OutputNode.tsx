import { Position, type Node, type NodeProps } from "@xyflow/react";
import { Flag } from "lucide-react";
import { NodeShell } from "./NodeShell";
import type { OutputNodeData } from "../types";

export function OutputNode({
  data,
  selected,
}: NodeProps<Node<OutputNodeData, "output">>) {
  return (
    <NodeShell
      icon={Flag}
      title={data.label}
      subtitle={data.resultKey ? `Result: ${data.resultKey}` : "Terminal node"}
      status={data.status}
      selected={selected}
      handles={[{ type: "target", position: Position.Left, id: "in" }]}
    />
  );
}
