import { Position, type Node, type NodeProps } from "@xyflow/react";
import {
  FolderOpen,
  FileText,
  ArrowLeftRight,
  Tag,
  Braces,
} from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type {
  FileReadNodeData,
  FileWriteNodeData,
  JsonParseNodeData,
  SetVariableNodeData,
  TransformNodeData,
} from "../types";

const inOut = [
  { type: "target", position: Position.Left, id: "in" },
  { type: "source", position: Position.Right, id: "out" },
] as const;

export function FileReadNode({
  data,
  selected,
}: NodeProps<Node<FileReadNodeData, "fileRead">>) {
  return (
    <NodeShell
      icon={FolderOpen}
      title={data.label}
      subtitle={data.pattern || "No pattern set"}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      <span className="font-mono break-all [overflow-wrap:anywhere]">
        {data.pattern ? truncate(data.pattern, 60) : "No pattern set"}
      </span>
    </NodeShell>
  );
}

export function FileWriteNode({
  data,
  selected,
}: NodeProps<Node<FileWriteNodeData, "fileWrite">>) {
  return (
    <NodeShell
      icon={FileText}
      title={data.label}
      subtitle={data.path || "No path set"}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      <span className="font-mono break-all [overflow-wrap:anywhere]">
        {data.path ? truncate(data.path, 60) : "No path set"}
      </span>
    </NodeShell>
  );
}

export function TransformNode({
  data,
  selected,
}: NodeProps<Node<TransformNodeData, "transform">>) {
  return (
    <NodeShell
      icon={ArrowLeftRight}
      title={data.label}
      subtitle="Expression"
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      <span className="font-mono break-all [overflow-wrap:anywhere]">
        {data.expression ? truncate(data.expression, 60) : "No expression set"}
      </span>
    </NodeShell>
  );
}

export function SetVariableNode({
  data,
  selected,
}: NodeProps<Node<SetVariableNodeData, "setVariable">>) {
  return (
    <NodeShell
      icon={Tag}
      title={data.label}
      subtitle={data.name ? `$${data.name}` : "No name set"}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.value ? truncate(data.value, 72) : "No value set"}
    </NodeShell>
  );
}

export function JsonParseNode({
  data,
  selected,
}: NodeProps<Node<JsonParseNodeData, "jsonParse">>) {
  return (
    <NodeShell
      icon={Braces}
      title={data.label}
      subtitle={data.path || "Root"}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      <span className="font-mono break-all [overflow-wrap:anywhere]">
        {data.source ? truncate(data.source, 60) : "No source set"}
      </span>
    </NodeShell>
  );
}
