import { Position, type Node, type NodeProps } from "@xyflow/react";
import { ClipboardCheck, Inbox, Send } from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type {
  ChatInputNodeData,
  ChatOutputNodeData,
  ReviewerNodeData,
} from "../types";

const inOut = [
  { type: "target", position: Position.Left, id: "in" },
  { type: "source", position: Position.Right, id: "out" },
] as const;

export function ReviewerNode({
  data,
  selected,
}: NodeProps<Node<ReviewerNodeData, "reviewer">>) {
  return (
    <NodeShell
      icon={ClipboardCheck}
      title={data.label}
      subtitle={`${data.harness}${data.model ? ` · ${data.model}` : ""}`}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.rubric ? truncate(data.rubric, 72) : "No rubric set"}
    </NodeShell>
  );
}

export function ChatInputNode({
  data,
  selected,
}: NodeProps<Node<ChatInputNodeData, "chatInput">>) {
  return (
    <NodeShell
      icon={Inbox}
      title={data.label}
      subtitle="Message entry"
      status={data.status}
      selected={selected}
      handles={[{ type: "source", position: Position.Right, id: "out" }]}
    >
      {data.placeholder ? truncate(data.placeholder, 72) : "No prompt set"}
    </NodeShell>
  );
}

export function ChatOutputNode({
  data,
  selected,
}: NodeProps<Node<ChatOutputNodeData, "chatOutput">>) {
  return (
    <NodeShell
      icon={Send}
      title={data.label}
      subtitle="Final reply"
      status={data.status}
      selected={selected}
      handles={[{ type: "target", position: Position.Left, id: "in" }]}
    >
      {data.message ? truncate(data.message, 72) : "No message set"}
    </NodeShell>
  );
}
