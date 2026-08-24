import { Position, type Node, type NodeProps } from "@xyflow/react";
import { UserCheck } from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type { ApprovalNodeData } from "../types";

export function ApprovalNode({
  data,
  selected,
}: NodeProps<Node<ApprovalNodeData, "approval">>) {
  return (
    <NodeShell
      icon={UserCheck}
      title={data.label}
      subtitle={data.approver || "Any approver"}
      status={data.status}
      selected={selected}
      handles={[
        { type: "target", position: Position.Left, id: "in" },
        { type: "source", position: Position.Right, id: "out" },
      ]}
    >
      {data.instructions ? truncate(data.instructions, 72) : "No instructions"}
    </NodeShell>
  );
}
