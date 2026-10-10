import type { NodeTypes } from "@xyflow/react";
import { TriggerNode } from "./TriggerNode";
import { AgentTaskNode } from "./AgentTaskNode";
import { GateNode } from "./GateNode";
import { ParallelNode } from "./ParallelNode";
import { JoinNode } from "./JoinNode";
import { ApprovalNode } from "./ApprovalNode";
import { ToolNode } from "./ToolNode";
import { OutputNode } from "./OutputNode";
import { LoopNode, DelayNode, SubflowNode } from "./FlowNodes";
import { ReviewerNode, ChatInputNode, ChatOutputNode } from "./AgentNodes";
import {
  PromptTemplateNode,
  LlmCallNode,
  StructuredOutputNode,
  NoteNode,
} from "./PromptNodes";
import {
  FileReadNode,
  FileWriteNode,
  TransformNode,
  SetVariableNode,
  JsonParseNode,
} from "./DataNodes";
import {
  HttpRequestNode,
  WebSearchNode,
  UrlFetchNode,
  NotifyNode,
  VectorSearchNode,
} from "./WebNodes";

export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  agentTask: AgentTaskNode,
  gate: GateNode,
  parallel: ParallelNode,
  join: JoinNode,
  approval: ApprovalNode,
  tool: ToolNode,
  output: OutputNode,
  loop: LoopNode,
  delay: DelayNode,
  subflow: SubflowNode,
  reviewer: ReviewerNode,
  chatInput: ChatInputNode,
  chatOutput: ChatOutputNode,
  promptTemplate: PromptTemplateNode,
  llmCall: LlmCallNode,
  structuredOutput: StructuredOutputNode,
  note: NoteNode,
  fileRead: FileReadNode,
  fileWrite: FileWriteNode,
  transform: TransformNode,
  setVariable: SetVariableNode,
  jsonParse: JsonParseNode,
  httpRequest: HttpRequestNode,
  webSearch: WebSearchNode,
  urlFetch: UrlFetchNode,
  notify: NotifyNode,
  vectorSearch: VectorSearchNode,
};
