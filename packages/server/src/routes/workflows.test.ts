import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import workflowRoutes from "./workflows";
import scheduleRoutes from "./schedules";
import { createSchedule, getScheduleRuns } from "../db/schedules";
import { fireSchedule } from "../scheduler/cronRunner";

/**
 * Run API + schedule wiring, tested over real HTTP against an in-process
 * Express app (VITEST uses an in-memory DB, so no fixtures leak anywhere).
 * Graphs stay harness-free (trigger/approval/note) so no CLI ever spawns.
 */

let base = "";

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const APPROVAL_GRAPH = {
  nodes: [
    { id: "n1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "T", triggerKind: "manual" } },
    { id: "n2", type: "approval", position: { x: 280, y: 0 }, data: { label: "G", approver: "", instructions: "check" } },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

const NOTE_GRAPH = {
  nodes: [
    { id: "n1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "T", triggerKind: "manual" } },
    { id: "n2", type: "note", position: { x: 280, y: 0 }, data: { label: "N", text: "hi" } },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

let server: ReturnType<import("express").Application["listen"]> | null = null;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/workflows", workflowRoutes);
  app.use("/api/schedules", scheduleRoutes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server!.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;
});

afterAll(async () => {
  // Drop keep-alive sockets first or close() waits for them to idle out.
  (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server!.close((err: unknown) => (err ? reject(err) : resolve()));
  });
});

describe("workflow run API", () => {
  it("404s a run for an unknown workflow", async () => {
    const { status, body } = await api("/workflows/nope/run", { method: "POST", body: "{}" });
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  it("runs trigger+approval to success through approve", async () => {
    const created = await api("/workflows", {
      method: "POST",
      body: JSON.stringify({ name: "run-me", nodes: APPROVAL_GRAPH.nodes, edges: APPROVAL_GRAPH.edges }),
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const started = await api(`/workflows/${id}/run`, { method: "POST", body: "{}" });
    expect(started.status).toBe(202);
    const runId = started.body.run.id as string;

    await vi.waitFor(async () => {
      const detail = await api(`/workflows/runs/${runId}`);
      expect(detail.body.run.status).toBe("waiting_approval");
    });

    const approved = await api(`/workflows/runs/${runId}/steps/n2/approve`, {
      method: "POST",
      body: JSON.stringify({ note: "fine" }),
    });
    expect(approved.body).toEqual({ ok: true });

    await vi.waitFor(async () => {
      const detail = await api(`/workflows/runs/${runId}`);
      expect(detail.body.run.status).toBe("success");
    });

    const history = await api(`/workflows/${id}/runs`);
    expect(history.body.runs.map((r: any) => r.id)).toContain(runId);

    const again = await api(`/workflows/runs/${runId}/steps/n2/approve`, {
      method: "POST",
      body: "{}",
    });
    expect(again.status).toBe(409);
  });
});

describe("schedule preview + firing", () => {
  it("previews cron runs and rejects bad expressions", async () => {
    const ok = await api("/schedules/preview?cron=" + encodeURIComponent("0 9 * * 1-5"));
    expect(ok.status).toBe(200);
    expect(ok.body.nextRuns).toHaveLength(5);
    expect(typeof ok.body.cronSummary).toBe("string");
    const bad = await api("/schedules/preview?cron=bogus");
    expect(bad.status).toBe(400);
  });

  it("fireSchedule runs a bound workflow for real", async () => {
    const created = await api("/workflows", {
      method: "POST",
      body: JSON.stringify({ name: "scheduled", nodes: NOTE_GRAPH.nodes, edges: NOTE_GRAPH.edges }),
    });
    const schedule = createSchedule({
      name: "every minute",
      cron_expression: "* * * * *",
      workflow_id: created.body.id,
      status: "active",
    });
    fireSchedule(schedule);
    await vi.waitFor(async () => {
      const runs = getScheduleRuns(schedule.id, 5);
      expect(runs.some((r) => r.status === "success")).toBe(true);
    });
  });
});
