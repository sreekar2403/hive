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
  | "output"
  | "loop"
  | "delay"
  | "subflow"
  | "reviewer"
  | "chatInput"
  | "chatOutput"
  | "promptTemplate"
  | "llmCall"
  | "structuredOutput"
  | "note"
  | "fileRead"
  | "fileWrite"
  | "transform"
  | "setVariable"
  | "jsonParse"
  | "httpRequest"
  | "webSearch"
  | "urlFetch"
  | "notify"
  | "vectorSearch";

export type NodeStatus = "idle" | "running" | "ok" | "failed";

export type TriggerKind = "manual" | "cron" | "webhook" | "file-change";
export type HarnessKind =
  | "opencode"
  | "claude-code"
  | "pi"
  | "codex"
  | "gemini"
  | "qwen"
  | "cursor-agent"
  | "aider"
  | "amp"
  | "goose"
  | "crush"
  | "copilot";
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

export interface LoopNodeData extends BaseNodeData {
  items: string;
  maxIterations: number;
}

export interface DelayNodeData extends BaseNodeData {
  waitSec: number;
  waitFor: string;
}

export interface SubflowNodeData extends BaseNodeData {
  workflowName: string;
  input: string;
}

export interface ReviewerNodeData extends BaseNodeData {
  harness: string;
  model: string;
  rubric: string;
}

export interface ChatInputNodeData extends BaseNodeData {
  placeholder: string;
}

export interface ChatOutputNodeData extends BaseNodeData {
  message: string;
}

export interface PromptTemplateNodeData extends BaseNodeData {
  template: string;
}

export interface LlmCallNodeData extends BaseNodeData {
  harness: string;
  model: string;
  prompt: string;
}

export interface StructuredOutputNodeData extends BaseNodeData {
  schema: string;
}

export interface NoteNodeData extends BaseNodeData {
  text: string;
}

export interface FileReadNodeData extends BaseNodeData {
  pattern: string;
}

export interface FileWriteNodeData extends BaseNodeData {
  path: string;
  content: string;
}

export interface TransformNodeData extends BaseNodeData {
  expression: string;
}

export interface SetVariableNodeData extends BaseNodeData {
  name: string;
  value: string;
}

export interface JsonParseNodeData extends BaseNodeData {
  source: string;
  path: string;
}

export interface HttpRequestNodeData extends BaseNodeData {
  method: string;
  url: string;
  body: string;
}

export interface WebSearchNodeData extends BaseNodeData {
  query: string;
  maxResults: number;
}

export interface UrlFetchNodeData extends BaseNodeData {
  url: string;
}

export interface NotifyNodeData extends BaseNodeData {
  channel: string;
  message: string;
}

export interface VectorSearchNodeData extends BaseNodeData {
  query: string;
  maxResults: number;
}

export type HiveNodeData =
  | TriggerNodeData
  | AgentTaskNodeData
  | GateNodeData
  | ParallelNodeData
  | JoinNodeData
  | ApprovalNodeData
  | ToolNodeData
  | OutputNodeData
  | LoopNodeData
  | DelayNodeData
  | SubflowNodeData
  | ReviewerNodeData
  | ChatInputNodeData
  | ChatOutputNodeData
  | PromptTemplateNodeData
  | LlmCallNodeData
  | StructuredOutputNodeData
  | NoteNodeData
  | FileReadNodeData
  | FileWriteNodeData
  | TransformNodeData
  | SetVariableNodeData
  | JsonParseNodeData
  | HttpRequestNodeData
  | WebSearchNodeData
  | UrlFetchNodeData
  | NotifyNodeData
  | VectorSearchNodeData;

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
