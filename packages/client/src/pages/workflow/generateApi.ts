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
