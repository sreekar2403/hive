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
  /**
   * The native session the last harness run lived in, in the CLI's own
   * id notation — for the chat handler to resume next turn. Null until a
   * run reports one (see `HarnessExecutionResult.sessionId`).
   */
  sessionId?: string | null;
  /** Which harness produced `sessionId` — resume is only valid on the same one. */
  sessionHarness?: string | null;
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
