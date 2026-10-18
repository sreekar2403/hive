import { describe, it, expect } from "vitest";
import {
  createWorkflowRun,
  recordWorkflowStep,
  updateWorkflowStep,
  updateWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  markInterruptedRuns,
} from "./workflowRuns";

describe("workflow run persistence", () => {
  it("round-trips a run with steps", () => {
    const run = createWorkflowRun({
      workflowId: "w1",
      projectId: "p1",
      trigger: "manual",
      input: "hi",
    });
    expect(run.status).toBe("queued");
    const step = recordWorkflowStep({ runId: run.id, nodeId: "n1", nodeType: "agentTask" });
    expect(step.status).toBe("pending");
    updateWorkflowStep(step.id, { status: "success", output: "done", finishedAt: Date.now() });
    updateWorkflowRun(run.id, { status: "success", output: "all done", finishedAt: Date.now() });
    const full = getWorkflowRun(run.id);
    expect(full?.steps).toHaveLength(1);
    expect(full?.steps[0].output).toBe("done");
    expect(listWorkflowRuns("w1").map((r) => r.id)).toContain(run.id);
  });

  it("marks interrupted runs failed on boot", () => {
    const run = createWorkflowRun({ workflowId: "w1", projectId: null, trigger: "schedule" });
    updateWorkflowRun(run.id, { status: "waiting_approval" });
    expect(markInterruptedRuns()).toBeGreaterThanOrEqual(1);
    expect(getWorkflowRun(run.id)?.status).toBe("failed");
    expect(getWorkflowRun(run.id)?.error).toMatch(/restarted/i);
  });
});