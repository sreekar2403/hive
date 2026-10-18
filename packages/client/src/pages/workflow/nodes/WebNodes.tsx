import { Position, type Node, type NodeProps } from "@xyflow/react";
import { Globe, Search, Link, Bell, Database } from "lucide-react";
import { NodeShell, truncate } from "./NodeShell";
import type {
  HttpRequestNodeData,
  NotifyNodeData,
  UrlFetchNodeData,
  VectorSearchNodeData,
  WebSearchNodeData,
} from "../types";

const inOut = [
  { type: "target", position: Position.Left, id: "in" },
  { type: "source", position: Position.Right, id: "out" },
] as const;

export function HttpRequestNode({
  data,
  selected,
}: NodeProps<Node<HttpRequestNodeData, "httpRequest">>) {
  return (
    <NodeShell
      icon={Globe}
      title={data.label}
      subtitle={data.method || "GET"}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      <span className="font-mono break-all [overflow-wrap:anywhere]">
        {data.url ? truncate(data.url, 60) : "No URL set"}
      </span>
    </NodeShell>
  );
}

export function WebSearchNode({
  data,
  selected,
}: NodeProps<Node<WebSearchNodeData, "webSearch">>) {
  return (
    <NodeShell
      icon={Search}
      title={data.label}
      subtitle={
        data.maxResults ? `Top ${data.maxResults} hits` : "Web search"
      }
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.query ? truncate(data.query, 72) : "No query set"}
    </NodeShell>
  );
}

export function UrlFetchNode({
  data,
  selected,
}: NodeProps<Node<UrlFetchNodeData, "urlFetch">>) {
  return (
    <NodeShell
      icon={Link}
      title={data.label}
      subtitle="Page → markdown"
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      <span className="font-mono break-all [overflow-wrap:anywhere]">
        {data.url ? truncate(data.url, 60) : "No URL set"}
      </span>
    </NodeShell>
  );
}

export function NotifyNode({
  data,
  selected,
}: NodeProps<Node<NotifyNodeData, "notify">>) {
  return (
    <NodeShell
      icon={Bell}
      title={data.label}
      subtitle={data.channel || "No channel set"}
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.message ? truncate(data.message, 72) : "No message set"}
    </NodeShell>
  );
}

export function VectorSearchNode({
  data,
  selected,
}: NodeProps<Node<VectorSearchNodeData, "vectorSearch">>) {
  return (
    <NodeShell
      icon={Database}
      title={data.label}
      subtitle="Second Brain"
      status={data.status}
      selected={selected}
      handles={[...inOut]}
    >
      {data.query ? truncate(data.query, 72) : "No query set"}
    </NodeShell>
  );
}
