export * from "./harness";
export * from "./protocol";

// Domain types
export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
  }>;
  metadata: Record<string, unknown>;
}

export interface LoopState {
  iteration: number;
  maxIterations: number;
  currentPrompt: string;
  previousOutput: string | null;
  success: boolean;
  error: string | null;
}

export interface RoutingDecision {
  harness: string;
  model: string;
  reasoning: string;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  action: string;
  description: string;
  command?: string;
  files?: string[];
  approved: boolean | null;
  timeoutAt: number;
}

export interface BranchInfo {
  name: string;
  branchManager: string;
  prUrl?: string;
}
