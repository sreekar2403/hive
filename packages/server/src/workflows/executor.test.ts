import { describe, it, expect, vi } from "vitest";
import {
  approveStep,
  denyStep,
  evalExpression,
  getRunPause,
  interpolate,
  renderTemplate,
  requestApproval,
  startWorkflowRun,
  getActiveRun,
  cancelRun,
} from "./executor";
import type { WorkflowExecDeps } from "./executor";

const GRAPH = {
  nodes: [
    { id: "n1", type: "trigger", data: { label: "T", triggerKind: "manual" } },
    { id: "n2", type: "setVariable", data: { label: "V", name: "topic", value: "llm-observability" } },
    { id: "n3", type: "agentTask", data: { label: "A", harness: "opencode", model: "", prompt: "Summarize {{topic}}", retries: 0, timeoutSec: 60 } },
    { id: "n4", type: "fileWrite", data: { label: "W", path: "out.md", content: "{{lastOutput}}" } },
    { id: "n5", type: "output", data: { label: "O", resultKey: "" } },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2" },
    { id: "e2", source: "n2", target: "n3" },
    { id: "e3", source: "n3", target: "n4" },
    { id: "e4", source: "n4", target: "n5" },
  ],
};

function testDeps(): WorkflowExecDeps {
  const files = new Map<string, string>();
  const log: string[] = [];
  return {
    runAgentTask: async ({ prompt }) => {
      log.push(`runAgentTask: prompt=${prompt}`);
      return { output: `ack:${prompt}`, filesChanged: [] };
    },
    execCommand: () => {
      log.push("execCommand called");
      return { ok: true, output: "" };
    },
    resolveProjectDir: () => {
      log.push("resolveProjectDir called");
      return "/repo";
    },
    readFile: async (_cwd, rel) => {
      log.push(`readFile: rel=${rel}`);
      return files.get(rel) ?? "";
    },
    writeFile: async (_cwd, rel, content) => {
      log.push(`writeFile: rel=${rel}, content=${content.substring(0, 30)}`);
      files.set(rel, content);
    },
    globFiles: async () => {
      log.push("globFiles called");
      return [];
    },
    fetchText: async () => ({ status: 200, text: "" }),
    searchBrain: async () => "",
    webHarness: () => null,
    destructivePatterns: [],
    requestApproval: async () => ({ approved: true }),
    resolveApproval: () => {},
  };
}

describe("interpolate", () => {
  it("fills known vars and leaves unknown ones", () => {
    expect(interpolate("hi {{name}} and {{missing}}", { name: "Bo" })).toBe("hi Bo and {{missing}}");
  });
});

describe("executor linear walk", () => {
  it("runs trigger to output, threading variables", async () => {
    const files = new Map<string, string>();
    const deps = testDeps();
    deps.writeFile = async (_cwd, rel, content) => {
      files.set(rel, content);
    };
    const { runId: linearRunId } = await startWorkflowRun(
      { workflowId: "w1", trigger: "manual", projectId: "p1", graph: GRAPH, input: "" },
      deps,
    );
    const { getWorkflowRun } = await import("../db/workflowRuns");
    expect(getWorkflowRun(linearRunId)?.status).toBe("success");
    expect(getActiveRun("w1")).toBeNull();
    expect(files.get("out.md")).toContain("ack:Summarize llm-observability");
  });

  it("rejects a second concurrent run with 409", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const deps = testDeps();
    deps.runAgentTask = () => gate.then(() => ({ output: "", filesChanged: [] }));
    const p1 = startWorkflowRun({ workflowId: "w2", trigger: "manual", graph: GRAPH }, deps);
    await expect(startWorkflowRun({ workflowId: "w2", trigger: "manual", graph: GRAPH }, deps)).rejects.toMatchObject({ status: 409 });
    const id = getActiveRun("w2")!;
    await cancelRun(id);
    release();
    await expect(p1).rejects.toThrow(/cancelled/i);
    expect(getActiveRun("w2")).toBeNull();
  });
});

describe("control flow", () => {
  it("gate follows the false branch", async () => {
    const deps = testDeps();
    const { runId: gateRunId } = await startWorkflowRun(
      {
        workflowId: "wg",
        trigger: "manual",
        graph: {
          nodes: [
            { id: "n1", type: "trigger", data: { label: "T" } },
            { id: "n2", type: "setVariable", data: { label: "V", name: "n", value: "0" } },
            { id: "n3", type: "gate", data: { label: "G", condition: "Number(n) > 0" } },
            { id: "n4", type: "note", data: { label: "Yes", text: "y" } },
            { id: "n5", type: "note", data: { label: "No", text: "n" } },
            { id: "n6", type: "output", data: { label: "O", resultKey: "" } },
          ],
          edges: [
            { id: "e1", source: "n1", target: "n2" },
            { id: "e2", source: "n2", target: "n3" },
            { id: "e3", source: "n3", target: "n4", sourceHandle: "true" },
            { id: "e4", source: "n3", target: "n5", sourceHandle: "false" },
            { id: "e5", source: "n5", target: "n6" },
          ],
        },
      },
      deps,
    );
    const { getWorkflowRun } = await import("../db/workflowRuns");
    const ran = getWorkflowRun(gateRunId)?.steps.map((s) => s.node_id) ?? [];
    expect(ran).toContain("n5");
    expect(ran).not.toContain("n4");
  });

  it("parallel fans out and join barriers", async () => {
    const seen: string[] = [];
    const deps = testDeps();
    deps.runAgentTask = async ({ prompt }) => {
      seen.push(prompt);
      return { output: prompt, filesChanged: [] };
    };
    await startWorkflowRun(
      {
        workflowId: "wp",
        trigger: "manual",
        graph: {
          nodes: [
            { id: "n1", type: "trigger", data: { label: "T" } },
            { id: "n2", type: "parallel", data: { label: "P", branches: 2 } },
            { id: "n3", type: "agentTask", data: { label: "A", harness: "h", model: "", prompt: "one", retries: 0, timeoutSec: 10 } },
            { id: "n4", type: "agentTask", data: { label: "B", harness: "h", model: "", prompt: "two", retries: 0, timeoutSec: 10 } },
            { id: "n5", type: "join", data: { label: "J", waitPolicy: "all" } },
            { id: "n6", type: "output", data: { label: "O", resultKey: "" } },
          ],
          edges: [
            { id: "e1", source: "n1", target: "n2" },
            { id: "e2", source: "n2", target: "n3" },
            { id: "e3", source: "n2", target: "n4" },
            { id: "e4", source: "n3", target: "n5" },
            { id: "e5", source: "n4", target: "n5" },
            { id: "e6", source: "n5", target: "n6" },
          ],
        },
      },
      deps,
    );
    expect(seen.sort()).toEqual(["one", "two"]);
  });

  it("loop iterates with item vars and caps", async () => {
    const seen: string[] = [];
    const deps = testDeps();
    deps.runAgentTask = async ({ prompt }) => {
      seen.push(prompt);
      return { output: "ok", filesChanged: [] };
    };
    await startWorkflowRun(
      {
        workflowId: "wl",
        trigger: "manual",
        graph: {
          nodes: [
            { id: "n1", type: "trigger", data: { label: "T" } },
            { id: "n2", type: "loop", data: { label: "L", items: "a\nb\nc", maxIterations: 2 } },
            { id: "n3", type: "agentTask", data: { label: "A", harness: "h", model: "", prompt: "do {{item}}", retries: 0, timeoutSec: 10 } },
          ],
          edges: [
            { id: "e1", source: "n1", target: "n2" },
            { id: "e2", source: "n2", target: "n3" },
          ],
        },
      },
      deps,
    );
    expect(seen).toEqual(["do a", "do b"]);
  });

  it("template names its missing variable", () => {
    expect(() => renderTemplate("hi {{who}}", {})).toThrow(/who/);
  });

  it("evaluates gate expressions without host access", () => {
    expect(evalExpression("Number(n) > 0", { n: "2" })).toBe(true);
    expect(() => evalExpression("process.exit()", {})).toThrow();
  });
});

describe("run file paths", () => {
  it("passes absolute paths through and still cages relative escapes", async () => {
    const { projectPath } = await import("./executor");
    expect(projectPath("C:/proj", "C:/elsewhere/a.md")).toMatch(/elsewhere/);
    expect(() => projectPath("C:/proj", "../outside.md")).toThrow(/project/i);
  });

  it("expands a directory pattern into its text files", async () => {
    const { globProjectFiles } = await import("./executor");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfread-"));
    fs.writeFileSync(path.join(dir, "a.md"), "hello");
    fs.writeFileSync(path.join(dir, "b.png"), "binary");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "c.txt"), "deep");
    try {
      const found = globProjectFiles("C:/proj", dir);
      expect(found).toContain(path.join(dir, "a.md"));
      expect(found).toContain(path.join(dir, "sub", "c.txt"));
      expect(found.some((f) => f.endsWith(".png"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names the pattern and folder when nothing matches", async () => {
    const deps = testDeps();
    await expect(
      startWorkflowRun(
        {
          workflowId: "wempty",
          trigger: "manual",
          graph: {
            nodes: [
              { id: "n1", type: "trigger", data: { label: "T" } },
              { id: "n2", type: "fileRead", data: { label: "R", pattern: "nothing/*.md" } },
            ],
            edges: [{ id: "e1", source: "n1", target: "n2" }],
          },
        },
        deps,
      ),
    ).rejects.toThrow(/nothing\/\*\.md/);
  });
});

describe("web, memory and notify nodes", () => {
  it("fetches http and stores the body", async () => {
    const deps = testDeps();
    deps.fetchText = async () => ({ status: 200, text: "hello page" });
    const { runId } = await startWorkflowRun(
      {
        workflowId: "wh",
        trigger: "manual",
        graph: {
          nodes: [
            { id: "n1", type: "trigger", data: { label: "T" } },
            { id: "n2", type: "httpRequest", data: { label: "H", method: "GET", url: "https://x.test/a", body: "" } },
            { id: "n3", type: "output", data: { label: "O", resultKey: "" } },
          ],
          edges: [
            { id: "e1", source: "n1", target: "n2" },
            { id: "e2", source: "n2", target: "n3" },
          ],
        },
      },
      deps,
    );
    expect(runId).toBeTruthy();
  });

  it("fails non-2xx with the status named", async () => {
    const deps = testDeps();
    deps.fetchText = async () => ({ status: 404, text: "nope" });
    await expect(
      startWorkflowRun(
        {
          workflowId: "wh2",
          trigger: "manual",
          graph: {
            nodes: [
              { id: "n1", type: "trigger", data: { label: "T" } },
              { id: "n2", type: "urlFetch", data: { label: "U", url: "https://x.test/missing" } },
            ],
            edges: [{ id: "e1", source: "n1", target: "n2" }],
          },
        },
        deps,
      ),
    ).rejects.toThrow(/404/);
  });

  it("posts webhooks and rejects bare channels", async () => {
    const posted: Array<{ url: string; body: string }> = [];
    const deps = testDeps();
    deps.fetchText = async (url, init) => {
      posted.push({ url, body: init?.body ?? "" });
      return { status: 200, text: "ok" };
    };
    await startWorkflowRun(
      {
        workflowId: "wn",
        trigger: "manual",
        graph: {
          nodes: [
            { id: "n1", type: "trigger", data: { label: "T" } },
            { id: "n2", type: "notify", data: { label: "N", channel: "https://hooks.test/x", message: "done {{lastOutput}}" } },
          ],
          edges: [{ id: "e1", source: "n1", target: "n2" }],
        },
      },
      deps,
    );
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toContain("done");
    const bad = testDeps();
    await expect(
      startWorkflowRun(
        {
          workflowId: "wn2",
          trigger: "manual",
          graph: {
            nodes: [
              { id: "n1", type: "trigger", data: { label: "T" } },
              { id: "n2", type: "notify", data: { label: "N", channel: "#general", message: "hi" } },
            ],
            edges: [{ id: "e1", source: "n1", target: "n2" }],
          },
        },
        bad,
      ),
    ).rejects.toThrow(/not configured/i);
  });

  it("searches the brain by keyword overlap", async () => {
    const deps = testDeps();
    deps.searchBrain = async () => "flaky tests: retry with backoff";
    const { runId } = await startWorkflowRun(
      {
        workflowId: "wv",
        trigger: "manual",
        graph: {
          nodes: [
            { id: "n1", type: "trigger", data: { label: "T" } },
            { id: "n2", type: "vectorSearch", data: { label: "V", query: "flaky tests", maxResults: 3 } },
            { id: "n3", type: "output", data: { label: "O", resultKey: "" } },
          ],
          edges: [
            { id: "e1", source: "n1", target: "n2" },
            { id: "e2", source: "n2", target: "n3" },
          ],
        },
      },
      deps,
    );
    expect(runId).toBeTruthy();
  });

  it("matches destructive commands on word boundaries", async () => {
    const { matchesDestructive } = await import("./executor");
    expect(matchesDestructive("rm -rf dist", ["rm"])).toBe(true);
    expect(matchesDestructive("confirm the platform ships", ["rm"])).toBe(false);
  });
});

describe("approval pause and resume", () => {
  it("pauses on approval and resumes with Approve", async () => {
    const deps = testDeps();
    // Real waiter (not the auto-approve stub): the run must actually pause.
    deps.requestApproval = requestApproval;
    const seen: string[] = [];
    deps.runAgentTask = async ({ prompt }) => {
      seen.push(prompt);
      return { output: "did it", filesChanged: [] };
    };
    const graph = {
      nodes: [
        { id: "n1", type: "trigger", data: { label: "T" } },
        { id: "n2", type: "agentTask", data: { label: "A", harness: "h", model: "", prompt: "work", retries: 0, timeoutSec: 10 } },
        { id: "n3", type: "approval", data: { label: "Gate", approver: "", instructions: "check it" } },
        { id: "n4", type: "fileWrite", data: { label: "W", path: "o.md", content: "{{lastOutput}}" } },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" },
        { id: "e3", source: "n3", target: "n4" },
      ],
    };
    const started = startWorkflowRun({ workflowId: "wa", trigger: "manual", graph }, deps);
    await vi.waitFor(() => expect(getRunPause("wa")).toBe("n3"));
    await approveStep(getActiveRun("wa")!, "n3", "looks good");
    const { runId } = await started;
    expect(seen).toEqual(["work"]);
    expect(runId).toBeTruthy();
  });

  it("deny fails the run with the note", async () => {
    const deps = testDeps();
    deps.requestApproval = requestApproval;
    const graph = {
      nodes: [
        { id: "n1", type: "trigger", data: { label: "T" } },
        { id: "n2", type: "approval", data: { label: "Gate", approver: "", instructions: "check" } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };
    const started = startWorkflowRun({ workflowId: "wd", trigger: "manual", graph }, deps);
    await vi.waitFor(() => expect(getRunPause("wd")).toBe("n2"));
    await denyStep(getActiveRun("wd")!, "n2", "not yet");
    await expect(started).rejects.toThrow(/not yet|denied/i);
  });
});