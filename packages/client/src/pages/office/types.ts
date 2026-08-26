/**
 * Shared types for the Office floor. `TaskPhase` mirrors the server's
 * packages/server/src/orchestrator.ts — a task's phase IS its zone, so
 * the two lists must stay in lockstep.
 */

export type TaskPhase =
  | "intake"
  | "bullpen"
  | "qa"
  | "conference"
  | "shipping"
  | "server-room"
  | "break-room";

/** Mirrors packages/server/src/routes/agents.ts's AgentSnapshot. */
export interface AgentSnapshot {
  id: string;
  name: string;
  harness: string;
  persona: string;
  phase: TaskPhase;
  taskId: string | null;
  taskPrompt: string | null;
  startedAt: number | null;
  filesTouched: string[];
  lastOutput: string | null;
  /** Loop iterations used so far (null while idle) — drives budget pips. */
  iteration?: number | null;
  maxIterations?: number;
}

export interface TilePoint {
  x: number;
  y: number;
}
