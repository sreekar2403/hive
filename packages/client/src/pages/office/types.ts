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
  /**
   * Sub-agents this character dispatched. Non-zero means it is coordinating
   * a fan-out: it runs no model and changes no files itself, so drawing it
   * as a peer of its agents makes it look like one that is stuck.
   */
  coordinating?: number;
  /** The coordinator that dispatched this agent, when one did. */
  dispatchedBy?: string | null;
}

export interface TilePoint {
  x: number;
  y: number;
}
