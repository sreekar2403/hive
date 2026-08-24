import { Position, type Node, type NodeProps } from "@xyflow/react";
import { GitMerge } from "lucide-react";
import { NodeShell } from "./NodeShell";
import type { JoinNodeData } from "../types";

const WAIT_LABEL: Record<JoinNodeData["waitPolicy"], string> = {
  all: "Wait for all",
  any: "Wait for any",
  first: "Wait for first",
};

export function JoinNode({
  data,
  selected,
}: NodeProps<Node<JoinNodeData, "join">>) {
  return (
    <NodeShell
      icon={GitMerge}
      title={data.label}
      subtitle={WAIT_LABEL[data.waitPolicy]}
      status={data.status}
      selected={selected}
      handles={[
        { type: "target", position: Position.Left, id: "in" },
        { type: "source", position: Position.Right, id: "out" },
      ]}
    />
  );
}
