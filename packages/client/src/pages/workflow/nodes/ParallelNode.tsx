import { Position, type Node, type NodeProps } from "@xyflow/react";
import { Split } from "lucide-react";
import { NodeShell } from "./NodeShell";
import type { ParallelNodeData } from "../types";

export function ParallelNode({
  data,
  selected,
}: NodeProps<Node<ParallelNodeData, "parallel">>) {
  return (
    <NodeShell
      icon={Split}
      title={data.label}
      subtitle={`${data.branches} branch${data.branches === 1 ? "" : "es"}`}
      status={data.status}
      selected={selected}
      handles={[
        { type: "target", position: Position.Left, id: "in" },
        { type: "source", position: Position.Right, id: "out" },
      ]}
    />
  );
}
