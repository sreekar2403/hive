import { Position, type Node, type NodeProps } from "@xyflow/react";
import { Repeat, Timer, Package } from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type {
  DelayNodeData,
  LoopNodeData,
  SubflowNodeData,
} from "../types";

const inOut = [
  { type: "target", position: Position.Left, id: "in" },
  { type: "source", position: Position.Right, id: "out" },
] as const;

export function LoopNode({
  data,
  selected,
}: NodeProps<Node<LoopNodeData, "loop">>) {
  return (
    <NodeShell
      icon={Repeat}
      title={data.label}
      subtitle={
        data.maxIterations ? `Up to ${data.maxIterations} iterations` : "Loop"
      }
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      <span className="font-mono break-all [overflow-wrap:anywhere]">
        {data.items ? truncate(data.items, 60) : "No items set"}
      </span>
    </NodeShell>
  );
}

export function DelayNode({
  data,
  selected,
}: NodeProps<Node<DelayNodeData, "delay">>) {
  return (
    <NodeShell
      icon={Timer}
      title={data.label}
      subtitle={`Wait ${data.waitSec ?? 60}s`}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.waitFor ? truncate(data.waitFor, 72) : "Fixed delay"}
    </NodeShell>
  );
}

export function SubflowNode({
  data,
  selected,
}: NodeProps<Node<SubflowNodeData, "subflow">>) {
  return (
    <NodeShell
      icon={Package}
      title={data.label}
      subtitle={data.workflowName || "No workflow set"}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.input ? truncate(data.input, 72) : "No input set"}
    </NodeShell>
  );
}
