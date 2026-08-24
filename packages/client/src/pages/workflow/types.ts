import type { Edge, Node } from "@xyflow/react";

/**
 * The workflow graph schema persisted to `/api/workflows`. Nodes and edges
 * are plain React Flow shapes so they round-trip through the server without
 * translation — `data` carries everything specific to Hive.
 */

export type HiveNodeKind =
  | "trigger"
  | "agentTask"
  | "gate"
  | "parallel"
  | "join"
  | "approval"
  | "tool"
  | "output";

export type NodeStatus = "idle" | "running" | "ok" | "failed";

export type TriggerKind = "manual" | "cron" | "webhook" | "file-change";
export type HarnessKind = "opencode" | "claude-code" | "pi";
export type WaitPolicy = "all" | "any" | "first";
export type ToolKind = "shell" | "git" | "http";

export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  status?: NodeStatus;
}

export interface TriggerNodeData extends BaseNodeData {
  triggerKind: TriggerKind;
  cron?: string;
  webhookPath?: string;
  filePattern?: string;
}

export interface AgentTaskNodeData extends BaseNodeData {
  harness: HarnessKind;
  model: string;
  prompt: string;
  retries: number;
  timeoutSec: number;
}

export interface GateNodeData extends BaseNodeData {
  condition: string;
}

export interface ParallelNodeData extends BaseNodeData {
  branches: number;
}

export interface JoinNodeData extends BaseNodeData {
  waitPolicy: WaitPolicy;
}

export interface ApprovalNodeData extends BaseNodeData {
  approver: string;
  instructions: string;
}

export interface ToolNodeData extends BaseNodeData {
  toolKind: ToolKind;
  command: string;
}

export interface OutputNodeData extends BaseNodeData {
  resultKey: string;
}

export type HiveNodeData =
  | TriggerNodeData
  | AgentTaskNodeData
  | GateNodeData
  | ParallelNodeData
  | JoinNodeData
  | ApprovalNodeData
  | ToolNodeData
  | OutputNodeData;

export type HiveNode = Node<HiveNodeData, HiveNodeKind>;

export interface HiveEdgeData extends Record<string, unknown> {
  branch?: "true" | "false";
}

export type HiveEdge = Edge<HiveEdgeData>;

export interface WorkflowRecord {
  id: string;
  name: string;
  projectId: string | null;
  nodes: HiveNode[];
  edges: HiveEdge[];
  created_at: number;
  updated_at: number;
}
