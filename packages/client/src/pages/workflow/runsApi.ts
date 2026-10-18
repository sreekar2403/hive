import { API } from "../../lib/api";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "success"
  | "failed"
  | "cancelled";

export type WorkflowRunStepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "success"
  | "failed"
  | "skipped";

export interface WorkflowRunRecord {
  id: string;
  workflow_id: string;
  project_id: string | null;
  trigger: string;
  schedule_id: string | null;
  input: string;
  output: string;
  error: string;
  status: WorkflowRunStatus;
  started_at: number;
  finished_at: number | null;
  steps?: WorkflowRunStepRecord[];
}

export interface WorkflowRunStepRecord {
  id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  status: WorkflowRunStepStatus;
  output: string;
  error: string;
  started_at: number;
  finished_at: number | null;
}

export async function startRun(
  workflowId: string,
  input?: string,
): Promise<WorkflowRunRecord> {
  const data = await API.post<{ run: WorkflowRunRecord }>(
    `/api/workflows/${workflowId}/run`,
    { input: input ?? "" },
  );
  return data.run;
}

export async function listRuns(workflowId: string): Promise<WorkflowRunRecord[]> {
  const data = await API.get<{ runs: WorkflowRunRecord[] }>(
    `/api/workflows/${workflowId}/runs`,
  );
  return data.runs;
}

export async function getRun(runId: string): Promise<WorkflowRunRecord> {
  const data = await API.get<{ run: WorkflowRunRecord }>(
    `/api/workflows/runs/${runId}`,
  );
  return data.run;
}

export async function approveRunStep(
  runId: string,
  nodeId: string,
  note?: string,
): Promise<void> {
  await API.post(`/api/workflows/runs/${runId}/steps/${nodeId}/approve`, {
    note: note ?? "",
  });
}

export async function denyRunStep(
  runId: string,
  nodeId: string,
  note?: string,
): Promise<void> {
  await API.post(`/api/workflows/runs/${runId}/steps/${nodeId}/deny`, {
    note: note ?? "",
  });
}

export async function cancelRun(runId: string): Promise<void> {
  await API.post(`/api/workflows/runs/${runId}/cancel`);
}
