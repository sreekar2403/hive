import {
  Zap,
  Bot,
  GitBranch,
  Split,
  GitMerge,
  UserCheck,
  Wrench,
  Flag,
  Repeat,
  Timer,
  Package,
  ClipboardCheck,
  Inbox,
  Send,
  Puzzle,
  Brain,
  Braces,
  StickyNote,
  FolderOpen,
  FileText,
  ArrowLeftRight,
  Tag,
  Globe,
  Search,
  Link,
  Bell,
  Database,
  type LucideIcon,
} from "lucide-react";
import type { HiveNodeData, HiveNodeKind } from "./types";

export type NodeCategory =
  | "Flow control"
  | "Work"
  | "Agents & chat"
  | "Prompts & models"
  | "Data & files"
  | "Tools & web";

export interface NodeTypeDef {
  kind: HiveNodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  category: NodeCategory;
  createData: () => HiveNodeData;
}

export const NODE_CATEGORIES: NodeCategory[] = [
  "Flow control",
  "Work",
  "Agents & chat",
  "Prompts & models",
  "Data & files",
  "Tools & web",
];

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
    kind: "loop",
    label: "Loop / For each",
    description: "Repeat over a list of items",
    icon: Repeat,
    category: "Flow control",
    createData: () => ({ label: "Loop", items: "", maxIterations: 10 }),
  },
  {
    kind: "delay",
    label: "Delay / Wait",
    description: "Pause or wait for a signal",
    icon: Timer,
    category: "Flow control",
    createData: () => ({ label: "Delay", waitSec: 60, waitFor: "" }),
  },
  {
    kind: "subflow",
    label: "Sub-workflow",
    description: "Call another workflow by name",
    icon: Package,
    category: "Flow control",
    createData: () => ({ label: "Sub-workflow", workflowName: "", input: "" }),
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
  {
    kind: "reviewer",
    label: "Reviewer / Judge",
    description: "LLM checks the previous result",
    icon: ClipboardCheck,
    category: "Agents & chat",
    createData: () => ({
      label: "Reviewer",
      harness: "opencode",
      model: "",
      rubric: "",
    }),
  },
  {
    kind: "chatInput",
    label: "Chat Input",
    description: "Accept a message to start",
    icon: Inbox,
    category: "Agents & chat",
    createData: () => ({ label: "Chat Input", placeholder: "" }),
  },
  {
    kind: "chatOutput",
    label: "Chat Output",
    description: "Reply with the final message",
    icon: Send,
    category: "Agents & chat",
    createData: () => ({ label: "Chat Output", message: "" }),
  },
  {
    kind: "promptTemplate",
    label: "Prompt Template",
    description: "Render a prompt with {{variables}}",
    icon: Puzzle,
    category: "Prompts & models",
    createData: () => ({ label: "Prompt Template", template: "" }),
  },
  {
    kind: "llmCall",
    label: "LLM Call",
    description: "One model call, no repo access",
    icon: Brain,
    category: "Prompts & models",
    createData: () => ({
      label: "LLM Call",
      harness: "opencode",
      model: "",
      prompt: "",
    }),
  },
  {
    kind: "structuredOutput",
    label: "Structured Output",
    description: "Force JSON matching a schema",
    icon: Braces,
    category: "Prompts & models",
    createData: () => ({ label: "Structured Output", schema: "" }),
  },
  {
    kind: "note",
    label: "Note",
    description: "Comment that runs nothing",
    icon: StickyNote,
    category: "Prompts & models",
    createData: () => ({ label: "Note", text: "" }),
  },
  {
    kind: "fileRead",
    label: "File Read",
    description: "Load a path, glob, or folder into context",
    icon: FolderOpen,
    category: "Data & files",
    createData: () => ({ label: "File Read", pattern: "" }),
  },
  {
    kind: "fileWrite",
    label: "File Write",
    description: "Write generated content to a path",
    icon: FileText,
    category: "Data & files",
    createData: () => ({ label: "File Write", path: "", content: "" }),
  },
  {
    kind: "transform",
    label: "Transform",
    description: "JS expression over step results",
    icon: ArrowLeftRight,
    category: "Data & files",
    createData: () => ({ label: "Transform", expression: "" }),
  },
  {
    kind: "setVariable",
    label: "Set Variable",
    description: "Save a value for later steps",
    icon: Tag,
    category: "Data & files",
    createData: () => ({ label: "Set Variable", name: "", value: "" }),
  },
  {
    kind: "jsonParse",
    label: "JSON Parse",
    description: "Extract fields from JSON text",
    icon: Braces,
    category: "Data & files",
    createData: () => ({ label: "JSON Parse", source: "", path: "" }),
  },
  {
    kind: "httpRequest",
    label: "HTTP Request",
    description: "GET/POST with headers + body",
    icon: Globe,
    category: "Tools & web",
    createData: () => ({
      label: "HTTP Request",
      method: "GET",
      url: "",
      body: "",
    }),
  },
  {
    kind: "webSearch",
    label: "Web Search",
    description: "Search the web, return hits",
    icon: Search,
    category: "Tools & web",
    createData: () => ({ label: "Web Search", query: "", maxResults: 5 }),
  },
  {
    kind: "urlFetch",
    label: "URL Fetch",
    description: "Fetch a page as markdown",
    icon: Link,
    category: "Tools & web",
    createData: () => ({ label: "URL Fetch", url: "" }),
  },
  {
    kind: "notify",
    label: "Notify",
    description: "Slack / email / webhook ping",
    icon: Bell,
    category: "Tools & web",
    createData: () => ({ label: "Notify", channel: "", message: "" }),
  },
  {
    kind: "vectorSearch",
    label: "Vector Search",
    description: "Query Second Brain memory",
    icon: Database,
    category: "Tools & web",
    createData: () => ({ label: "Vector Search", query: "", maxResults: 5 }),
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
