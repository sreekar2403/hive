import { Position, type Node, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type { GateNodeData } from "../types";

export function GateNode({
  data,
  selected,
}: NodeProps<Node<GateNodeData, "gate">>) {
  return (
    <NodeShell
      icon={GitBranch}
      title={data.label}
      subtitle="Condition"
      status={data.status}
      selected={selected}
      handles={[
        { type: "target", position: Position.Left, id: "in" },
        {
          type: "source",
          position: Position.Bottom,
          id: "true",
          style: { left: "30%" },
        },
        {
          type: "source",
          position: Position.Bottom,
          id: "false",
          style: { left: "70%" },
        },
      ]}
    >
      <div className="font-mono mb-2">
        {data.condition ? truncate(data.condition, 60) : "No condition set"}
      </div>
      <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wide text-faint">
        <span>True</span>
        <span>False</span>
      </div>
    </NodeShell>
  );
}
