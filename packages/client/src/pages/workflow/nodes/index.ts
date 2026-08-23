import type { NodeTypes } from "@xyflow/react";
import { TriggerNode } from "./TriggerNode";
import { AgentTaskNode } from "./AgentTaskNode";
import { GateNode } from "./GateNode";
import { ParallelNode } from "./ParallelNode";
import { JoinNode } from "./JoinNode";
import { ApprovalNode } from "./ApprovalNode";
import { ToolNode } from "./ToolNode";
import { OutputNode } from "./OutputNode";

export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  agentTask: AgentTaskNode,
  gate: GateNode,
  parallel: ParallelNode,
  join: JoinNode,
  approval: ApprovalNode,
  tool: ToolNode,
  output: OutputNode,
};
