import { API } from "../../lib/api";
import type { HiveEdge, HiveNode, WorkflowRecord } from "./types";

/** Strips React Flow's transient runtime fields before persisting. */
export function sanitizeNodes(nodes: HiveNode[]): HiveNode[] {
  return nodes.map((n) => {
    const {
      selected: _selected,
      dragging: _dragging,
      measured: _measured,
      ...rest
    } = n as HiveNode & { measured?: unknown };
    return rest as HiveNode;
  });
}

export function sanitizeEdges(edges: HiveEdge[]): HiveEdge[] {
  return edges.map((e) => {
    const { selected: _selected, ...rest } = e;
    return rest as HiveEdge;
  });
}

export async function listWorkflows(
  projectId: string,
): Promise<WorkflowRecord[]> {
  const data = await API.get<{ workflows: WorkflowRecord[] }>(
    `/api/workflows?projectId=${encodeURIComponent(projectId)}`,
  );
  return data.workflows;
}

export async function createWorkflow(input: {
  name: string;
  projectId: string;
  nodes?: HiveNode[];
  edges?: HiveEdge[];
}): Promise<WorkflowRecord> {
  return API.post<WorkflowRecord>("/api/workflows", input);
}

export async function updateWorkflow(
  id: string,
  input: Partial<{
    name: string;
    nodes: HiveNode[];
    edges: HiveEdge[];
    projectId: string;
  }>,
): Promise<WorkflowRecord> {
  return API.put<WorkflowRecord>(`/api/workflows/${id}`, input);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await API.del(`/api/workflows/${id}`);
}
