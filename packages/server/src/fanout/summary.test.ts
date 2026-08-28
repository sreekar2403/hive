import { describe, it, expect } from "vitest";
import { briefSubAgent, composeFanoutAnswer, type SubResult } from "./summary";
import type { SubTask } from "./planner";

const frontend: SubResult = {
  taskId: "t1",
  title: "Frontend PRD",
  harness: "opencode",
  branch: "hive/frontend-prd-aaaaaaaa",
  success: true,
  output: "Wrote docs/frontend-prd.md covering screens, state and routing.",
  filesChanged: ["docs/frontend-prd.md"],
};

const backend: SubResult = {
  taskId: "t2",
  title: "Backend PRD",
  harness: "codex",
  branch: "hive/backend-prd-bbbbbbbb",
  success: false,
  output: "",
  filesChanged: [],
  error: "Model timed out",
};

describe("composeFanoutAnswer", () => {
  it("counts what finished and what did not", () => {
    const answer = composeFanoutAnswer([frontend, backend], null);
    expect(answer).toMatch(/Ran 2 agents in parallel — 1 finished, 1 did not/);
  });

  it("reports every agent, including the failed one", () => {
    const answer = composeFanoutAnswer([frontend, backend], null);
    expect(answer).toContain("## Frontend PRD");
    expect(answer).toContain("## Backend PRD");
    expect(answer).toContain("Model timed out");
    expect(answer).toContain("docs/frontend-prd.md");
  });

  it("says so when a successful agent changed nothing", () => {
    const idle = { ...frontend, filesChanged: [], output: "Nothing to do." };
    expect(composeFanoutAnswer([idle, backend], null)).toContain(
      "No files changed.",
    );
  });

  it("names the branch and target of a merge", () => {
    const answer = composeFanoutAnswer([frontend, backend], {
      merged: ["hive/frontend-prd-aaaaaaaa"],
      conflicted: null,
      skipped: ["t2"],
      target: "feat/prd",
    });
    expect(answer).toContain("Merged into `feat/prd`");
    expect(answer).toContain("1 agent(s) had nothing to merge.");
  });

  it("spells out a conflict with its files", () => {
    const answer = composeFanoutAnswer([frontend, backend], {
      merged: [],
      conflicted: {
        branch: "hive/backend-prd-bbbbbbbb",
        files: ["docs/shared.md"],
      },
      skipped: [],
      target: "main",
    });
    expect(answer).toContain("conflicts in 1 file(s)");
    expect(answer).toContain("docs/shared.md");
    expect(answer).toContain("left unmerged");
  });

  it("truncates a long answer rather than dropping it", () => {
    const chatty = { ...frontend, output: "x".repeat(5000) };
    const answer = composeFanoutAnswer([chatty], null);
    expect(answer).toContain("_(truncated)_");
    expect(answer.length).toBeLessThan(3000);
  });

  it("includes the reason for splitting when there is one", () => {
    const answer = composeFanoutAnswer([frontend], null, "Two documents.");
    expect(answer).toContain("Why it was split: Two documents.");
  });
});

describe("briefSubAgent", () => {
  const tasks: SubTask[] = [
    { title: "Frontend PRD", prompt: "Write docs/frontend-prd.md" },
    { title: "Backend PRD", prompt: "Write docs/backend-prd.md" },
  ];

  it("leads with the agent's own instruction", () => {
    expect(briefSubAgent(tasks[0], tasks, "the original")).toMatch(
      /^Write docs\/frontend-prd\.md/,
    );
  });

  it("tells the agent what its siblings are doing", () => {
    const brief = briefSubAgent(tasks[0], tasks, "the original");
    expect(brief).toContain("Backend PRD: Write docs/backend-prd.md");
    expect(brief).toContain("Do not write the files listed below");
  });

  it("does not list the agent against itself", () => {
    const brief = briefSubAgent(tasks[0], tasks, "the original");
    const mentions = brief.split("Frontend PRD").length - 1;
    expect(mentions).toBe(0);
  });

  it("carries the original request through", () => {
    expect(
      briefSubAgent(tasks[0], tasks, "read the PRD and split it"),
    ).toContain("read the PRD and split it");
  });

  it("omits the siblings block when there are none", () => {
    const solo = briefSubAgent(tasks[0], [tasks[0]], "the original");
    expect(solo).not.toContain("Other agents on this request");
  });
});
