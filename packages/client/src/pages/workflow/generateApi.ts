import { API } from "../../lib/api";
import type { HiveEdge, HiveNode } from "./types";

export interface GeneratedGraph {
  nodes: HiveNode[];
  edges: HiveEdge[];
  warnings: string[];
  /** Which harness drafted the graph. Absent from older servers. */
  draftedBy?: string;
}

/** Asks the server to draft a workflow from a plain-text description. */
export async function generateWorkflow(input: {
  description: string;
  harness?: string;
  model?: string;
  maxNodes?: number;
}): Promise<GeneratedGraph> {
  if (!input.description.trim()) {
    throw new Error("Describe the workflow first.");
  }
  return API.post<GeneratedGraph>("/api/workflows/generate", input);
}

/**
 * Names a workflow created by Apply-from-empty-state. First line of the
 * description, capped — falls back when the description is blank (the
 * dialog blocks Generate then, but Apply must never create "untitled-…").
 */
export function deriveWorkflowName(description: string): string {
  const first = description.split("\n")[0].trim().replace(/\s+/g, " ");
  if (!first) return "Generated workflow";
  return first.length > 48 ? `${first.slice(0, 47)}…` : first;
}
