import {
  Zap,
  Bot,
  GitBranch,
  Split,
  GitMerge,
  UserCheck,
  Wrench,
  Flag,
  type LucideIcon,
} from "lucide-react";
import type { HiveNodeData, HiveNodeKind } from "./types";

export type NodeCategory = "Flow control" | "Work";

export interface NodeTypeDef {
  kind: HiveNodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  category: NodeCategory;
  createData: () => HiveNodeData;
}

export const NODE_CATEGORIES: NodeCategory[] = ["Flow control", "Work"];

export const NODE_DEFS: NodeTypeDef[] = [
  {
    kind: "trigger",
    label: "Trigger",
    description: "Manual, cron, webhook, or file-change entry point",
    icon: Zap,
    category: "Flow control",
    createData: () => ({ label: "Trigger", triggerKind: "manual" }),
  },
  {
    kind: "gate",
    label: "Gate / Condition",
    description: "Branch on an expression",
    icon: GitBranch,
    category: "Flow control",
    createData: () => ({ label: "Condition", condition: "" }),
  },
  {
    kind: "parallel",
    label: "Parallel",
    description: "Fan out to N branches",
    icon: Split,
    category: "Flow control",
    createData: () => ({ label: "Parallel", branches: 2 }),
  },
  {
    kind: "join",
    label: "Join",
    description: "Fan in with a wait policy",
    icon: GitMerge,
    category: "Flow control",
    createData: () => ({ label: "Join", waitPolicy: "all" }),
  },
  {
    kind: "output",
    label: "Output / End",
    description: "Terminal node",
    icon: Flag,
    category: "Flow control",
    createData: () => ({ label: "Output", resultKey: "" }),
  },
  {
    kind: "agentTask",
    label: "Agent Task",
    description: "Run a harness against the repo",
    icon: Bot,
    category: "Work",
    createData: () => ({
      label: "Agent Task",
      harness: "claude-code",
      model: "",
      prompt: "",
      retries: 2,
      timeoutSec: 300,
    }),
  },
  {
    kind: "tool",
    label: "Tool",
    description: "Shell, git, or HTTP call",
    icon: Wrench,
    category: "Work",
    createData: () => ({ label: "Tool", toolKind: "shell", command: "" }),
  },
  {
    kind: "approval",
    label: "Approval",
    description: "Pause for a human decision",
    icon: UserCheck,
    category: "Work",
    createData: () => ({ label: "Approval", approver: "", instructions: "" }),
  },
];

export const NODE_KIND_LABEL: Record<HiveNodeKind, string> = Object.fromEntries(
  NODE_DEFS.map((d) => [d.kind, d.label]),
) as Record<HiveNodeKind, string>;

export function nodeDef(kind: HiveNodeKind): NodeTypeDef {
  const def = NODE_DEFS.find((d) => d.kind === kind);
  if (!def) throw new Error(`Unknown node kind: ${kind}`);
  return def;
}
