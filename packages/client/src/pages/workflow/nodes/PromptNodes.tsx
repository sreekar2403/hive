import { Position, type Node, type NodeProps } from "@xyflow/react";
import { Puzzle, Brain, Braces, StickyNote } from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type {
  LlmCallNodeData,
  NoteNodeData,
  PromptTemplateNodeData,
  StructuredOutputNodeData,
} from "../types";

const inOut = [
  { type: "target", position: Position.Left, id: "in" },
  { type: "source", position: Position.Right, id: "out" },
] as const;

export function PromptTemplateNode({
  data,
  selected,
}: NodeProps<Node<PromptTemplateNodeData, "promptTemplate">>) {
  return (
    <NodeShell
      icon={Puzzle}
      title={data.label}
      subtitle="Template"
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.template ? truncate(data.template, 72) : "No template set"}
    </NodeShell>
  );
}

export function LlmCallNode({
  data,
  selected,
}: NodeProps<Node<LlmCallNodeData, "llmCall">>) {
  return (
    <NodeShell
      icon={Brain}
      title={data.label}
      subtitle={`${data.harness}${data.model ? ` · ${data.model}` : ""}`}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.prompt ? truncate(data.prompt, 72) : "No prompt set"}
    </NodeShell>
  );
}

export function StructuredOutputNode({
  data,
  selected,
}: NodeProps<Node<StructuredOutputNodeData, "structuredOutput">>) {
  return (
    <NodeShell
      icon={Braces}
      title={data.label}
      subtitle="JSON schema"
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      <span className="font-mono break-all [overflow-wrap:anywhere]">
        {data.schema ? truncate(data.schema, 60) : "No schema set"}
      </span>
    </NodeShell>
  );
}

export function NoteNode({
  data,
  selected,
}: NodeProps<Node<NoteNodeData, "note">>) {
  return (
    <NodeShell
      icon={StickyNote}
      title={data.label}
      subtitle="Runs nothing"
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.text ? truncate(data.text, 72) : "Empty note"}
    </NodeShell>
  );
}
