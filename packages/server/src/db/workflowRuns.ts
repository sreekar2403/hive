import { randomUUID } from "crypto";
import { getDb } from "./database";

const db = getDb();

export type WorkflowRunStatus = "queued" | "running" | "waiting_approval" | "success" | "failed" | "cancelled";
export type WorkflowRunStepStatus = "pending" | "running" | "waiting_approval" | "success" | "failed" | "skipped";

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  project_id: string | null;
  trigger: "manual" | "schedule" | "subflow";
  schedule_id: string | null;
  input: string;
  output: string;
  error: string;
  status: WorkflowRunStatus;
  started_at: number;
  finished_at: number | null;
}

export interface WorkflowRunStep {
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

export function createWorkflowRun(input: {
  workflowId: string;
  projectId: string | null;
  trigger: WorkflowRun["trigger"];
  scheduleId?: string | null;
  input?: string;
}): WorkflowRun {
  const run: WorkflowRun = {
    id: randomUUID(),
    workflow_id: input.workflowId,
    project_id: input.projectId,
    trigger: input.trigger,
    schedule_id: input.scheduleId ?? null,
    input: input.input ?? "",
    output: "",
    error: "",
    status: "queued",
    started_at: Date.now(),
    finished_at: null,
  };

  getDb().prepare(
    `INSERT INTO workflow_runs (id, workflow_id, project_id, trigger, schedule_id, input, output, error, status, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.workflow_id,
    run.project_id,
    run.trigger,
    run.schedule_id,
    run.input,
    run.output,
    run.error,
    run.status,
    run.started_at,
    run.finished_at,
  );

  return run;
}

export function updateWorkflowRun(
  id: string,
  patch: {
    status?: WorkflowRunStatus;
    output?: string;
    error?: string;
    finishedAt?: number | null;
  },
): WorkflowRun | null {
  const existing = getWorkflowRun(id);
  if (!existing) return null;

  const status = patch.status ?? existing.status;
  const output = patch.output ?? existing.output;
  const error = patch.error ?? existing.error;
  const finishedAt = patch.finishedAt ?? existing.finished_at;

  getDb().prepare(
    `UPDATE workflow_runs SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?`,
  ).run(status, output, error, finishedAt, id);

  return getWorkflowRun(id);
}

export function getWorkflowRun(id: string): (WorkflowRun & { steps: WorkflowRunStep[] }) | null {
  const runStmt = db.prepare("SELECT * FROM workflow_runs WHERE id = ?");
  const row = runStmt.get(id) as WorkflowRun | undefined;
  if (!row) return null;

  const stepStmt = db.prepare(
    "SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY started_at ASC",
  );
  const steps = (stepStmt.all(id) as WorkflowRunStep[]) || [];

  return { ...row, steps };
}

export function listWorkflowRuns(workflowId: string, limit?: number): WorkflowRun[] {
  const where = "WHERE workflow_id = ?";
  const params = [workflowId];

  const limitClause = limit !== undefined ? "LIMIT ?" : "";
  const limitParam = limit !== undefined ? [limit] : [];

  const stmt = db.prepare(
    `SELECT * FROM workflow_runs ${where} ORDER BY started_at DESC ${limitClause}`,
  );
  const rows = stmt.all(...params, ...limitParam) as WorkflowRun[];

  return rows;
}

export function recordWorkflowStep(input: {
  runId: string;
  nodeId: string;
  nodeType: string;
}): WorkflowRunStep {
  const id = randomUUID();
  const now = Date.now();

  const step: WorkflowRunStep = {
    id,
    run_id: input.runId,
    node_id: input.nodeId,
    node_type: input.nodeType,
    status: "pending",
    output: "",
    error: "",
    started_at: now,
    finished_at: null,
  };

  getDb().prepare(
    `INSERT INTO workflow_run_steps (id, run_id, node_id, node_type, status, output, error, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    step.id,
    step.run_id,
    step.node_id,
    step.node_type,
    step.status,
    step.output,
    step.error,
    step.started_at,
    step.finished_at,
  );

  return step;
}

export function updateWorkflowStep(
  id: string,
  patch: {
    status?: WorkflowRunStepStatus;
    output?: string;
    error?: string;
    finishedAt?: number | null;
  },
): void {
  const existing = getWorkflowRunStep(id);
  if (!existing) return;

  const status = patch.status ?? existing.status;
  const output = patch.output ?? existing.output;
  const error = patch.error ?? existing.error;
  const finishedAt = patch.finishedAt ?? existing.finished_at;

  getDb().prepare(
    `UPDATE workflow_run_steps SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?`,
  ).run(status, output, error, finishedAt, id);
}

export function getWorkflowRunStep(id: string): WorkflowRunStep | undefined {
  const stmt = db.prepare("SELECT * FROM workflow_run_steps WHERE id = ?");
  return stmt.get(id) as WorkflowRunStep | undefined;
}

export function markInterruptedRuns(): number {
  const stmt = db.prepare(
    `UPDATE workflow_runs SET status = 'failed', error = 'server restarted' WHERE status IN ('running', 'waiting_approval')`,
  );
  const result = stmt.run();
  return (result as any).changes;
}