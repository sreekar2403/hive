import { describe, it, expect } from "vitest";
import { buildScheduleBody, validateScheduleInput } from "./ScheduleModal";

describe("schedule modal", () => {
  it("builds the submit body with the workflow attached", () => {
    expect(
      buildScheduleBody({
        name: "  Nightly  ",
        cron: "0 2 * * *",
        active: true,
        projectId: "p1",
        workflowId: "w1",
      }),
    ).toEqual({
      name: "Nightly",
      cron_expression: "0 2 * * *",
      status: "active",
      project_id: "p1",
      workflow_id: "w1",
    });
  });

  it("pauses when toggled off", () => {
    const body = buildScheduleBody({
      name: "N",
      cron: "* * * * *",
      active: false,
      projectId: null,
      workflowId: "w1",
    });
    expect(body.status).toBe("paused");
  });

  it("requires a name and a cron expression", () => {
    expect(validateScheduleInput("", "0 9 * * *")).toMatch(/name/i);
    expect(validateScheduleInput("N", "  ")).toMatch(/cron/i);
    expect(validateScheduleInput("N", "0 9 * * *")).toBeNull();
  });
});
