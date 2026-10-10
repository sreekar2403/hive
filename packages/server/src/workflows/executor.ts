import { randomUUID } from "crypto";
import * as path from "node:path";
import * as fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { broadcast } from "../routes/events";
import { getDb } from "../db/database";
import { extractJsonObject } from "../llmJson";
import { Orchestrator } from "../orchestrator";
import {
  createWorkflowRun,
  getWorkflowRun,
  markInterruptedRuns,
  updateWorkflowRun,
  recordWorkflowStep,
  updateWorkflowStep,
} from "../db/workflowRuns";

/**
 * Timed expression evaluation for gate conditions and transforms.
 * Convenience isolation only (spec §4): the app already spawns
 * shell-capable agents locally, so this is not a security boundary.
 */
export function evalExpression(code: string, vars: Record<string, string>): unknown {
  return vm.runInNewContext(`(${code})`, { ...vars }, { timeout: 1000 });
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  const missing = [...template.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[1])
    .find((name) => !Object.prototype.hasOwnProperty.call(vars, name));
  if (missing) {
    throw new Error(`Unknown variable {{${missing}}}: no earlier step produced it.`);
  }
  return interpolate(template, vars);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHttp(
  node: GraphNode,
  vars: Record<string, string>,
  deps: WorkflowExecDeps,
): Promise<string> {
  const method = (str(node.data, "method") || "GET").toUpperCase();
  const url = interpolate(str(node.data, "url"), vars).trim();
  if (!url) throw new Error(`"${nodeLabel(node)}" needs a URL.`);
  const body = str(node.data, "body") ? interpolate(str(node.data, "body"), vars) : undefined;
  const res = await deps.fetchText(url, { method, body });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${method} ${url} failed with status ${res.status}.`);
  }
  return res.text;
}

/** Tag-stripping fetch-body cleanup: scripts die, tags become spaces. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

export class WorkflowRunError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

export interface AgentResult { output: string; filesChanged: string[] }
export interface FetchResult {
  status: number;
  text: string;
}

export interface WorkflowExecDeps {
  runAgentTask(input: { prompt: string; harness: string; model: string; projectId: string | null; timeoutMs: number }): Promise<AgentResult>;
  execCommand(command: string, cwd: string): { ok: boolean; output: string };
  resolveProjectDir(projectId: string | null): string;
  readFile(cwd: string, rel: string): Promise<string>;
  writeFile(cwd: string, rel: string, content: string): Promise<void>;
  globFiles(cwd: string, pattern: string): Promise<string[]>;
  fetchText(url: string, init?: { method?: string; body?: string }): Promise<FetchResult>;
  searchBrain(projectId: string | null, query: string, maxResults: number): Promise<string>;
  webHarness(): string | null;
  destructivePatterns: string[];
  requestApproval(
    runId: string,
    nodeId: string,
    instructions: string,
  ): Promise<{ approved: boolean; note?: string }>;
  resolveApproval(runId: string, nodeId: string, approved: boolean, note?: string): void;
}

/**
 * Word-boundary destructive-command match, same semantics as
 * permissions.ts: quoted regions are blanked first, patterns are regex-
 * escaped, and \b applies where the pattern starts/ends with a word char.
 */
export function matchesDestructive(command: string, patterns: string[]): boolean {
  const stripped = command.replace(/"[^"]*"|'[^']*'/g, " ");
  return patterns.some((p) => {
    if (!p) return false;
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leading = /^\w/.test(p) ? "\\b" : "";
    const trailing = /\w$/.test(p) ? "\\b" : "";
    return new RegExp(`${leading}${escaped}${trailing}`, "i").test(stripped);
  });
}

interface ApprovalWaiter {
  nodeId: string;
  resolve: (decision: { approved: boolean; note?: string }) => void;
}

const approvers = new Map<string, ApprovalWaiter>();

function approvalTimeoutMs(): number {
  try {
    const orch = Orchestrator.getActive() as unknown as {
      config?: { permission?: { timeout?: number } };
    } | null;
    const t = orch?.config?.permission?.timeout;
    if (typeof t === "number" && Number.isFinite(t) && t > 0) return t * 1000;
  } catch {
    // No orchestrator (tests) — fall through to the default.
  }
  return 60_000;
}

export function requestApproval(
  runId: string,
  nodeId: string,
  instructions: string,
): Promise<{ approved: boolean; note?: string }> {
  void instructions;
  return new Promise<{ approved: boolean; note?: string }>((resolve) => {
    const timer = setTimeout(() => {
      if (approvers.get(runId)?.nodeId === nodeId) approvers.delete(runId);
      resolve({ approved: false, note: "Approval timed out." });
    }, approvalTimeoutMs());
    if (timer.unref) timer.unref();
    approvers.set(runId, {
      nodeId,
      resolve: (decision) => {
        clearTimeout(timer);
        resolve(decision);
      },
    });
  });
}

export function resolveApproval(runId: string, nodeId: string, approved: boolean, note?: string): void {
  const waiter = approvers.get(runId);
  if (!waiter || waiter.nodeId !== nodeId) {
    throw new WorkflowRunError(409, `No pending approval for that step.`);
  }
  approvers.delete(runId);
  waiter.resolve({ approved, note });
}

function defaultExecCommand(command: string, cwd: string): { ok: boolean; output: string } {
  try {
    const out = execFileSync(command, { cwd, shell: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) as unknown as string;
    return { ok: true, output: String(out ?? "").slice(0, 20000) };
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
    const out = [e.stdout, e.stderr].filter((x) => typeof x === "string").join("\n");
    return { ok: false, output: (out || e.message || "command failed").slice(0, 20000) };
  }
}

/**
 * Where a run file path points. An explicitly absolute path goes where it
 * says — the user typed it deliberately, and the harness steps in the same
 * run can already read the whole machine. Only RELATIVE paths are caged to
 * the project, which is what stops `..` smuggled in through `{{variables}}`
 * from walking out of it.
 */
export function projectPath(cwd: string, rel: string): string {
  if (path.isAbsolute(rel)) return path.normalize(rel);
  const abs = path.resolve(cwd, rel);
  if (abs !== cwd && !abs.startsWith(cwd + path.sep)) {
    throw new Error(
      `Path escapes the project folder (${cwd}): "${rel}". Use a path inside the project or an absolute path.`,
    );
  }
  return abs;
}

/** Extensions never useful as LLM context — skipped during folder reads. */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".exe", ".dll", ".so", ".dylib",
  ".node", ".pyc", ".pyo", ".class", ".o", ".a", ".lib", ".mp3", ".mp4",
  ".wav", ".avi", ".mov", ".ttf", ".otf", ".woff", ".woff2",
]);

const MAX_READ_FILES = 20;
const MAX_READ_BYTES = 200_000;

/**
 * Minimal glob without new deps: exact paths, one-level `dir/<star>.ext`,
 * and recursive doublestar globs. Everything resolves through projectPath,
 * so `..` escapes fail the same way direct reads do. Returns
 * project-relative paths.
 */
export function globProjectFiles(cwd: string, pattern: string): string[] {
  const norm = pattern.replace(/\\/g, "/").trim();
  if (!norm) return [];
  // A bare path: a file reads directly, a directory expands to its text
  // files (users point File Read at research folders, not just globs).
  if (!norm.includes("*")) {
    const abs = projectPath(cwd, norm);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isDirectory()) return readDirFiles(abs);
    return fs.statSync(abs).isFile() ? [abs] : [];
  }
  const starStar = norm.indexOf("**");
  const baseDir = starStar >= 0 ? norm.slice(0, starStar).replace(/\/$/, "") : norm.slice(0, norm.indexOf("*")).replace(/\/$/, "");
  const ext = norm.slice(norm.lastIndexOf("*.") + 1);
  const start = baseDir ? projectPath(cwd, baseDir) : cwd;
  const recursive = starStar >= 0;
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive && e.name !== "node_modules" && e.name !== ".git") walk(abs);
      } else if (
        e.isFile() &&
        (ext === "*" || abs.endsWith(`.${ext}`)) &&
        !BINARY_EXTENSIONS.has(path.extname(e.name).toLowerCase())
      ) {
        out.push(abs);
      }
    }
  };
  walk(start);
  return out.sort();
}

/** Text files under a directory, shallow-capped so a folder can't flood context. */
function readDirFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    if (out.length >= MAX_READ_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_READ_FILES) return;
      if (e.name === "node_modules" || e.name === ".git") continue;
      const abs = path.join(current, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && !BINARY_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(abs);
    }
  };
  walk(dir);
  return out.sort();
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    return match;
  });
}

const active = new Map<string, string>(); // workflowId -> runId
const cancelled = new Set<string>(); // runIds

export function getActiveRun(workflowId: string): string | null { return active.get(workflowId) ?? null; }

/** Node id awaiting approval in this workflow's active run, if any (test + UI seam). */
export function getRunPause(workflowId: string): string | null {
  const runId = active.get(workflowId);
  if (!runId) return null;
  return approvers.get(runId)?.nodeId ?? null;
}

export async function cancelRun(runId: string): Promise<void> {
  const waiter = approvers.get(runId);
  if (waiter) {
    try {
      resolveApproval(runId, waiter.nodeId, false, "Run cancelled.");
    } catch {
      // Already resolved between lookup and resolve — the run still ends.
    }
  }
  cancelled.add(runId);
}

export async function approveStep(runId: string, nodeId: string, note?: string): Promise<void> {
  if (!getWorkflowRun(runId)) throw new WorkflowRunError(404, "Run not found.");
  resolveApproval(runId, nodeId, true, note);
}

export async function denyStep(runId: string, nodeId: string, note?: string): Promise<void> {
  if (!getWorkflowRun(runId)) throw new WorkflowRunError(404, "Run not found.");
  resolveApproval(runId, nodeId, false, note);
}

/** Boot recovery: in-flight runs from a dead process must not stay "live". */
export function recoverInterruptedRuns(): number {
  active.clear();
  approvers.clear();
  cancelled.clear();
  return markInterruptedRuns();
}

function loadWorkflowGraph(workflowId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const row = getDb().prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId) as
    | { nodes: string; edges: string }
    | undefined;
  if (!row) throw new WorkflowRunError(404, "Workflow not found.");
  return { nodes: JSON.parse(row.nodes || "[]"), edges: JSON.parse(row.edges || "[]") };
}

export interface StartRunInput {
  workflowId: string;
  trigger: "manual" | "schedule" | "subflow";
  scheduleId?: string;
  projectId?: string | null;
  input?: string;
  graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
  depth?: number;
  chain?: string[];
}

interface LaunchedRun {
  run: { id: string; workflow_id: string; project_id: string | null };
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  deps: WorkflowExecDeps;
  input: StartRunInput;
}

/**
 * Synchronous prefix: 409 check, row creation, registry claim. Fully sync
 * so two rapid starts cannot both slip past the one-active-run guard.
 */
function beginRun(input: StartRunInput, partial?: Partial<WorkflowExecDeps>): LaunchedRun {
  if (active.has(input.workflowId)) {
    throw new WorkflowRunError(409, "A run is already active for this workflow.");
  }
  const graph = input.graph ?? loadWorkflowGraph(input.workflowId);
  const deps: WorkflowExecDeps = { ...defaultDeps(), ...partial };
  const run = createWorkflowRun({
    workflowId: input.workflowId,
    projectId: input.projectId ?? null,
    trigger: input.trigger,
    scheduleId: input.scheduleId,
    input: input.input ?? "",
  });
  active.set(input.workflowId, run.id);
  return { run, graph, deps, input };
}

async function driveRun(
  launched: LaunchedRun,
  onSettled?: (ok: boolean) => void,
): Promise<{ runId: string }> {
  const { run, graph, deps, input } = launched;
  updateWorkflowRun(run.id, { status: "running" });
  emit(run, null, "started", {});
  let ok = false;
  try {
    const vars: Record<string, string> = { input: input.input ?? "" };
    const ctx: RunCtx = { depth: input.depth ?? 0, chain: [...(input.chain ?? []), input.workflowId] };
    const output = await runChain(graph, triggerNode(graph), run, vars, deps, ctx);
    if (cancelled.has(run.id)) throw new WorkflowRunError(499, "Run cancelled.");
    updateWorkflowRun(run.id, { status: "success", output, finishedAt: Date.now() });
    emit(run, null, "finished", { status: "success" });
    ok = true;
    return { runId: run.id };
  } catch (err) {
    const failed = err instanceof WorkflowRunError && err.status === 499;
    updateWorkflowRun(run.id, {
      status: failed ? "cancelled" : "failed",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: Date.now(),
    });
    emit(run, null, "finished", { status: failed ? "cancelled" : "failed" });
    throw err;
  } finally {
    if (active.get(input.workflowId) === run.id) active.delete(input.workflowId);
    cancelled.delete(run.id);
    onSettled?.(ok);
  }
}

/**
 * Full-await start: resolves only when the run settles (success) or rejects
 * on failure/cancel. Used by tests, subflows, and callers that need the
 * outcome — NOT by HTTP handlers (see launchWorkflowRun).
 */
export async function startWorkflowRun(
  input: StartRunInput,
  partial?: Partial<WorkflowExecDeps>,
): Promise<{ runId: string }> {
  return driveRun(beginRun(input, partial));
}

/**
 * Fire-and-forget start for HTTP/cron: claims the run synchronously (so the
 * id is known and 409s are exact) and drives it detached. Settlement is
 * already persisted by driveRun; `onSettled` is for side effects like
 * closing a schedule run row.
 */
export function launchWorkflowRun(
  input: StartRunInput,
  partial?: Partial<WorkflowExecDeps>,
  onSettled?: (ok: boolean) => void,
): string {
  const launched = beginRun(input, partial);
  void driveRun(launched, onSettled).catch(() => {
    // Swallowed here on purpose: driveRun persisted the failure to the run
    // row and emitted the finish event; there is nobody left to throw to.
  });
  return launched.run.id;
}

interface StepRow {
  id: string;
  node_id: string;
  node_type: string;
}

function emit(
  run: { id: string; workflow_id: string },
  step: StepRow | null,
  kind: "started" | "step" | "finished" | "approval",
  data?: Record<string, unknown>,
): void {
  const event: Record<string, unknown> = {
    type: "workflow",
    workflowId: run.workflow_id,
    runId: run.id,
  };
  if (step) {
    event.stepId = step.id;
    event.nodeId = step.node_id;
    event.nodeType = step.node_type;
  }
  broadcast(`workflow:run:${kind}`, data ? { ...event, ...data } : event);
}

interface GraphNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

function triggerNode(graph: { nodes: GraphNode[] }): string {
  return graph.nodes.find((n) => n.type === "trigger")?.id ?? graph.nodes[0].id;
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v : "";
}

function num(data: Record<string, unknown>, key: string, fallback: number): number {
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

interface RunCtx {
  depth: number;
  /** Workflow ids in the current subflow chain, for cycle detection. */
  chain: string[];
}

interface ChainResult {
  output: string;
  /** stopAt node reached (parallel branch parking), if any. */
  stoppedAt: string | null;
}

async function runChain(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  startId: string,
  run: { id: string; workflow_id: string; project_id: string | null },
  vars: Record<string, string>,
  deps: WorkflowExecDeps,
  ctx: RunCtx,
): Promise<string> {
  const res = await runFrom(graph, startId, run, vars, deps, ctx, new Set<string>(), new Set<string>());
  return res.output;
}

function outgoing(graph: { edges: GraphEdge[] }, id: string): GraphEdge[] {
  return graph.edges.filter((e) => e.source === id);
}

async function runFrom(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  startId: string,
  run: { id: string; workflow_id: string; project_id: string | null },
  vars: Record<string, string>,
  deps: WorkflowExecDeps,
  ctx: RunCtx,
  visited: Set<string>,
  stopAt: Set<string>,
): Promise<ChainResult> {
  let currentId: string | null = startId;
  while (currentId) {
    if (cancelled.has(run.id)) throw new WorkflowRunError(499, "Run cancelled.");
    if (visited.has(currentId)) {
      throw new Error(`Cycle detected at "${currentId}" — the graph must not loop back on itself.`);
    }
    visited.add(currentId);
    const node = graph.nodes.find((n) => n.id === currentId);
    if (!node) throw new Error(`Node ${currentId} not found`);
    if (stopAt.has(node.id)) return { output: vars.lastOutput ?? "", stoppedAt: node.id };
    const cwd = deps.resolveProjectDir(run.project_id);

    const step = recordWorkflowStep({ runId: run.id, nodeId: node.id, nodeType: node.type });
    emit(run, step, "step", { status: "running" });
    try {
      if (node.type === "gate") {
        currentId = await runGate(graph, node, run, vars, step);
        continue;
      }
      if (node.type === "parallel") {
        currentId = await runParallel(graph, node, run, vars, deps, ctx, visited);
        updateWorkflowStep(step.id, { status: "success", output: "", finishedAt: Date.now() });
        emit(run, step, "step", { status: "success" });
        continue;
      }
      if (node.type === "loop") {
        currentId = await runLoop(graph, node, run, vars, deps, ctx, visited);
        updateWorkflowStep(step.id, { status: "success", output: "", finishedAt: Date.now() });
        emit(run, step, "step", { status: "success" });
        continue;
      }
      if (node.type === "subflow") {
        const output = await runSubflow(node, run, vars, deps, ctx);
        vars[node.id] = output;
        vars.lastOutput = output;
        updateWorkflowStep(step.id, { status: "success", output, finishedAt: Date.now() });
        emit(run, step, "step", { status: "success" });
        currentId = nextLinear(graph, currentId);
        continue;
      }
      if (node.type === "approval") {
        const instructions = interpolate(str(node.data, "instructions"), vars);
        updateWorkflowStep(step.id, { status: "waiting_approval" });
        updateWorkflowRun(run.id, { status: "waiting_approval" });
        emit(run, step, "step", { status: "waiting_approval" });
        emit(run, step, "approval", { instructions });
        const decision = await deps.requestApproval(run.id, node.id, instructions);
        updateWorkflowRun(run.id, { status: "running" });
        if (!decision.approved) {
          throw new Error(
            decision.note
              ? `Not approved at "${nodeLabel(node)}": ${decision.note}`
              : `Denied at "${nodeLabel(node)}".`,
          );
        }
        const out = `approved${decision.note ? `: ${decision.note}` : ""}`;
        vars[node.id] = out;
        vars.lastOutput = out;
        updateWorkflowStep(step.id, { status: "success", output: out, finishedAt: Date.now() });
        emit(run, step, "step", { status: "success" });
        currentId = nextLinear(graph, currentId);
        continue;
      }
      const output = await executeNode(node, run, vars, deps, cwd, step);
      vars[node.id] = output;
      vars.lastOutput = output;
      const done = node.type === "note" ? "skipped" : "success";
      updateWorkflowStep(step.id, { status: done, output, finishedAt: Date.now() });
      emit(run, step, "step", { status: done });
      currentId = nextLinear(graph, currentId);
    } catch (err) {
      if (!(err instanceof WorkflowRunError && err.status === 499)) {
        const message = err instanceof Error ? err.message : String(err);
        updateWorkflowStep(step.id, { status: "failed", error: message, finishedAt: Date.now() });
        emit(run, step, "step", { status: "failed", error: message });
      }
      throw err;
    }
  }
  return { output: vars.lastOutput ?? "", stoppedAt: null };
}

async function runGate(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  node: GraphNode,
  run: { id: string },
  vars: Record<string, string>,
  step: StepRow,
): Promise<string | null> {
  void run;
  const cond = str(node.data, "condition");
  if (!cond.trim()) throw new Error(`"${nodeLabel(node)}" needs a condition.`);
  let ok: boolean;
  try {
    ok = Boolean(evalExpression(cond, vars));
  } catch (err) {
    throw new Error(`"${nodeLabel(node)}" condition failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const want = ok ? "true" : "false";
  const edge = graph.edges.find((e) => e.source === node.id && e.sourceHandle === want);
  if (!edge) throw new Error(`"${nodeLabel(node)}" has no ${want} branch connected.`);
  updateWorkflowStep(step.id, { status: "success", output: want, finishedAt: Date.now() });
  return edge.target;
}

async function runParallel(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  node: GraphNode,
  run: { id: string; workflow_id: string; project_id: string | null },
  vars: Record<string, string>,
  deps: WorkflowExecDeps,
  ctx: RunCtx,
  visited: Set<string>,
): Promise<string | null> {
  const targets = outgoing(graph, node.id).map((e) => e.target);
  if (targets.length === 0) throw new Error(`"${nodeLabel(node)}" has no branches.`);
  const joins = new Set(graph.nodes.filter((n) => n.type === "join").map((n) => n.id));
  type Settled = { target: string; vars: Record<string, string>; output: string; stoppedAt: string | null; error: unknown };
  const runs = targets.map((t) => {
    const bvars = { ...vars };
    return runFrom(graph, t, run, bvars, deps, ctx, new Set(visited), joins).then(
      (r): Settled => ({ target: t, vars: bvars, output: r.output, stoppedAt: r.stoppedAt, error: null }),
      (err): Settled => ({ target: t, vars: bvars, output: "", stoppedAt: null, error: err }),
    );
  });
  // waitPolicy any/first continues on the first branch; the rest still
  // complete detached (their steps are already recorded by their chains).
  // all barriers on every branch. Either way vars merge deterministically
  // in edge order once each branch lands.
  const waitAll = str(node.data, "waitPolicy") !== "any" && str(node.data, "waitPolicy") !== "first";
  const merge = (s: Settled) => {
    Object.assign(vars, s.vars);
    if (s.output) vars.lastOutput = s.output;
  };
  let settled: Settled[];
  if (waitAll) {
    settled = await Promise.all(runs);
  } else {
    const winner = await Promise.race(runs);
    if (winner.error) throw winner.error;
    merge(winner);
    for (const r of runs) void r.then((s) => { if (s !== winner && !s.error) merge(s); });
    settled = [winner];
  }
  const failed = settled.find((s) => s.error);
  if (failed) throw failed.error;
  for (const s of settled) merge(s);
  const stops = settled.map((s) => s.stoppedAt).filter((s): s is string => !!s);
  const joinId = stops[0] ?? null;
  if (joinId && !stops.every((s) => s === joinId)) {
    throw new Error(`"${nodeLabel(node)}" branches must converge at one join.`);
  }
  if (!joinId) return null;
  const join = graph.nodes.find((n) => n.id === joinId)!;
  const joinStep = recordWorkflowStep({ runId: run.id, nodeId: join.id, nodeType: join.type });
  emit(run, joinStep, "step", { status: "running" });
  updateWorkflowStep(joinStep.id, { status: "success", output: "", finishedAt: Date.now() });
  emit(run, joinStep, "step", { status: "success" });
  const next = outgoing(graph, joinId);
  return next[0]?.target ?? null;
}

async function runLoop(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  node: GraphNode,
  run: { id: string; workflow_id: string; project_id: string | null },
  vars: Record<string, string>,
  deps: WorkflowExecDeps,
  ctx: RunCtx,
  visited: Set<string>,
): Promise<string | null> {
  const raw = interpolate(str(node.data, "items"), vars);
  const trimmed = raw.trim();
  let items: string[];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`"${nodeLabel(node)}" items is not a JSON array or line list.`);
    }
    if (!Array.isArray(parsed)) throw new Error(`"${nodeLabel(node)}" items is not a JSON array or line list.`);
    items = parsed.map((x) => String(x));
  } else {
    items = trimmed.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  const outs = outgoing(graph, node.id);
  if (outs.length === 0) throw new Error(`"${nodeLabel(node)}" needs a step to repeat.`);
  const cap = Math.max(1, num(node.data, "maxIterations", 10));
  for (const [i, item] of items.slice(0, cap).entries()) {
    if (cancelled.has(run.id)) throw new WorkflowRunError(499, "Run cancelled.");
    vars.item = item;
    vars.itemIndex = String(i);
    await runFrom(graph, outs[0].target, run, vars, deps, ctx, new Set(visited), new Set<string>());
  }
  delete vars.item;
  delete vars.itemIndex;
  return outs[1]?.target ?? null;
}

async function runSubflow(
  node: GraphNode,
  run: { id: string; workflow_id: string; project_id: string | null },
  vars: Record<string, string>,
  deps: WorkflowExecDeps,
  ctx: RunCtx,
): Promise<string> {
  void deps;
  const name = str(node.data, "workflowName").trim();
  if (!name) throw new Error(`"${nodeLabel(node)}" needs a workflow name.`);
  if (ctx.depth >= 3) throw new Error("Sub-workflows nest at most 3 deep.");
  const row = getDb().prepare("SELECT * FROM workflows WHERE name = ?").get(name) as
    | { id: string; nodes: string; edges: string }
    | undefined;
  if (!row) throw new Error(`Sub-workflow "${name}" not found.`);
  if (ctx.chain.includes(row.id)) throw new Error(`Sub-workflow cycle at "${name}".`);
  let sub: { nodes: GraphNode[]; edges: GraphEdge[] };
  try {
    sub = { nodes: JSON.parse(row.nodes || "[]"), edges: JSON.parse(row.edges || "[]") };
  } catch {
    throw new Error(`Sub-workflow "${name}" has unreadable data.`);
  }
  const input = interpolate(str(node.data, "input"), vars);
  const res = await startWorkflowRun({
    workflowId: row.id,
    trigger: "subflow",
    projectId: run.project_id,
    graph: sub,
    depth: ctx.depth + 1,
    chain: [...ctx.chain, row.id],
    input,
  });
  const full = getWorkflowRun(res.runId);
  return full?.output ?? "";
}

async function executeNode(
  node: GraphNode,
  run: { id: string; workflow_id: string; project_id: string | null },
  vars: Record<string, string>,
  deps: WorkflowExecDeps,
  cwd: string,
  step: StepRow,
): Promise<string> {
  switch (node.type) {
    case "trigger":
    case "note":
      return "";
    case "setVariable": {
      const name = str(node.data, "name").trim();
      if (!name) throw new Error(`"${nodeLabel(node)}" needs a variable name.`);
      vars[name] = interpolate(str(node.data, "value"), vars);
      return vars[name];
    }
    case "agentTask":
    case "llmCall":
    case "reviewer": {
      const prompt =
        node.type === "reviewer"
          ? `Review this result against the rubric, then give the verdict.\nRubric:\n${interpolate(str(node.data, "rubric"), vars)}\n\nResult:\n${vars.lastOutput ?? ""}`
          : node.type === "llmCall"
            ? `Do not modify any files; answer directly.\n\n${interpolate(str(node.data, "prompt"), vars)}`
            : interpolate(str(node.data, "prompt"), vars);
      if (!prompt.trim()) throw new Error(`"${nodeLabel(node)}" has no prompt.`);
      const result = await deps.runAgentTask({
        prompt,
        harness: str(node.data, "harness"),
        model: str(node.data, "model"),
        projectId: run.project_id,
        timeoutMs: num(node.data, "timeoutSec", 300) * 1000,
      });
      return result.output;
    }
    case "tool": {
      const toolKind = str(node.data, "toolKind") || "shell";
      if (toolKind !== "shell" && toolKind !== "git") {
        throw new WorkflowRunError(422, `Node kind "tool/${toolKind}" is not executable yet.`);
      }
      const command = interpolate(str(node.data, "command"), vars);
      if (!command.trim()) throw new Error(`"${nodeLabel(node)}" needs a command.`);
      if (matchesDestructive(command, deps.destructivePatterns)) {
        updateWorkflowStep(step.id, { status: "waiting_approval" });
        updateWorkflowRun(run.id, { status: "waiting_approval" });
        emit(run, step, "step", { status: "waiting_approval" });
        emit(run, step, "approval", { instructions: `Run this destructive command? ${command}` });
        const decision = await deps.requestApproval(run.id, node.id, command);
        updateWorkflowRun(run.id, { status: "running" });
        if (!decision.approved) {
          throw new Error(
            decision.note
              ? `Not approved at "${nodeLabel(node)}": ${decision.note}`
              : `Destructive command refused at "${nodeLabel(node)}".`,
          );
        }
        updateWorkflowStep(step.id, { status: "running" });
      }
      const res = deps.execCommand(command, cwd);
      if (!res.ok) throw new Error(`"${nodeLabel(node)}" failed: ${res.output}`);
      return res.output;
    }
    case "fileRead": {
      const pattern = str(node.data, "pattern").trim();
      if (!pattern) throw new Error(`"${nodeLabel(node)}" needs a file pattern.`);
      const files = await deps.globFiles(cwd, pattern);
      if (files.length === 0) {
        throw new Error(
          `"${nodeLabel(node)}" matched no files for "${pattern}" in ${cwd}. Check the path, or point it at a folder.`,
        );
      }
      const contents = await Promise.all(files.map((f) => deps.readFile(cwd, f)));
      let content = contents.join("\n---\n");
      if (content.length > MAX_READ_BYTES) {
        content =
          content.slice(0, MAX_READ_BYTES) +
          `\n…[truncated ${content.length - MAX_READ_BYTES} more characters]`;
      }
      return content;
    }
    case "fileWrite": {
      const rel = str(node.data, "path").trim();
      if (!rel) throw new Error(`"${nodeLabel(node)}" needs a file path.`);
      const content = interpolate(str(node.data, "content"), vars);
      await deps.writeFile(cwd, rel, content);
      return content;
    }
    case "output":
    case "chatOutput": {
      const message = str(node.data, "message") || str(node.data, "resultKey");
      if (node.type === "output" && !message) return vars.lastOutput ?? "";
      return interpolate(message, vars);
    }
    case "delay": {
      const secs = Math.min(3600, Math.max(0, num(node.data, "waitSec", 60)));
      if (secs > 0) await sleep(secs * 1000);
      return "";
    }
    case "chatInput": {
      return vars.input ?? str(node.data, "placeholder");
    }
    case "promptTemplate": {
      const template = str(node.data, "template");
      if (!template.trim()) throw new Error(`"${nodeLabel(node)}" needs a template.`);
      return renderTemplate(template, vars);
    }
    case "structuredOutput": {
      const prev = vars.lastOutput ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(prev);
      } catch {
        throw new Error(`"${nodeLabel(node)}" needs JSON from the previous step.`);
      }
      const schemaText = str(node.data, "schema").trim();
      if (schemaText) {
        let schema: unknown;
        try {
          schema = JSON.parse(schemaText);
        } catch {
          throw new Error(`"${nodeLabel(node)}" schema is not valid JSON.`);
        }
        const required =
          typeof schema === "object" && schema !== null && Array.isArray((schema as { required?: unknown }).required)
            ? (schema as { required: unknown[] }).required.filter((k): k is string => typeof k === "string")
            : [];
        const missing = required.filter(
          (k) => typeof parsed !== "object" || parsed === null || !(k in (parsed as Record<string, unknown>)),
        );
        if (missing.length > 0) {
          throw new Error(`"${nodeLabel(node)}" missing required key(s): ${missing.join(", ")}.`);
        }
      }
      return prev;
    }
    case "transform": {
      const expression = str(node.data, "expression");
      if (!expression.trim()) throw new Error(`"${nodeLabel(node)}" needs an expression.`);
      let value: unknown;
      try {
        value = evalExpression(expression, vars);
      } catch (err) {
        throw new Error(`"${nodeLabel(node)}" expression failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return value == null ? "" : String(value);
    }
    case "httpRequest": {
      return runHttp(node, vars, deps);
    }
    case "urlFetch": {
      const url = interpolate(str(node.data, "url"), vars).trim();
      if (!url) throw new Error(`"${nodeLabel(node)}" needs a URL.`);
      const res = await deps.fetchText(url, { method: "GET" });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Fetch of ${url} failed with status ${res.status}.`);
      }
      return htmlToText(res.text);
    }
    case "notify": {
      const channel = interpolate(str(node.data, "channel"), vars).trim();
      const message = interpolate(str(node.data, "message"), vars);
      if (!channel) throw new Error(`"${nodeLabel(node)}" needs a channel.`);
      if (!/^https?:\/\//i.test(channel)) {
        throw new Error(
          `Slack/email notifications are not configured — use a webhook URL as the channel.`,
        );
      }
      const res = await deps.fetchText(channel, { method: "POST", body: JSON.stringify({ message }) });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Notify to ${channel} failed with status ${res.status}.`);
      }
      return message;
    }
    case "webSearch": {
      const query = interpolate(str(node.data, "query"), vars).trim();
      if (!query) throw new Error(`"${nodeLabel(node)}" needs a query.`);
      const max = num(node.data, "maxResults", 5);
      const harness = deps.webHarness();
      if (!harness) throw new Error("No web-capable harness is installed for web search.");
      const result = await deps.runAgentTask({
        prompt:
          `Search the web for: ${query}. Reply with ONLY JSON, no prose: ` +
          `{"results": [{"title": "...", "url": "...", "snippet": "..."}]} (at most ${max}).`,
        harness,
        model: "",
        projectId: run.project_id,
        timeoutMs: 120_000,
      });
      const parsed = extractJsonObject(result.output) as { results?: unknown } | null;
      const results = Array.isArray(parsed?.results) ? parsed.results : null;
      if (!results) throw new Error(`"${nodeLabel(node)}" returned no usable results.`);
      const lines = results.slice(0, Math.max(1, max)).map((r) => {
        const item = (r ?? {}) as Record<string, unknown>;
        const title = typeof item.title === "string" ? item.title : "Untitled";
        const link = typeof item.url === "string" ? ` (${item.url})` : "";
        const snippet = typeof item.snippet === "string" ? `: ${item.snippet}` : "";
        return `- ${title}${link}${snippet}`;
      });
      vars[`${node.id}.json`] = JSON.stringify(results.slice(0, Math.max(1, max)));
      return lines.join("\n");
    }
    case "vectorSearch": {
      const query = interpolate(str(node.data, "query"), vars).trim();
      if (!query) throw new Error(`"${nodeLabel(node)}" needs a query.`);
      return deps.searchBrain(run.project_id, query, num(node.data, "maxResults", 5));
    }
    case "jsonParse": {
      const src = interpolate(str(node.data, "source"), vars);
      let doc: unknown;
      try {
        doc = JSON.parse(src);
      } catch {
        throw new Error(`"${nodeLabel(node)}" source is not valid JSON.`);
      }
      const dot = str(node.data, "path").trim();
      if (!dot) return typeof doc === "string" ? doc : JSON.stringify(doc);
      const val = dot.split(".").reduce<unknown>(
        (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[ /^\d+$/.test(key) ? Number(key) : key ]),
        doc,
      );
      if (val === undefined) throw new Error(`"${nodeLabel(node)}" path "${dot}" not found.`);
      return typeof val === "string" ? val : JSON.stringify(val);
    }
    default:
      throw new WorkflowRunError(422, `Node kind "${node.type}" is not executable yet.`);
  }
}

function nodeLabel(node: GraphNode): string {
  const label = node.data.label;
  return typeof label === "string" && label ? label : node.id;
}

function nextLinear(graph: { edges: GraphEdge[] }, currentId: string): string | null {
  const edges = graph.edges.filter((e) => e.source === currentId);
  if (edges.length > 1) throw new WorkflowRunError(422, "Branches need parallel (Task 3)");
  return edges[0]?.target ?? null;
}

function defaultDeps(): WorkflowExecDeps {
  const orch = Orchestrator.getActive();
  return {
    // Per-node timeoutMs is advisory: runaway agents are governed by the
    // loop engine's own idle/total timeouts from server config.
    runAgentTask: async ({ prompt, harness, model, projectId, timeoutMs: _timeoutMs }) => {
      if (!orch) throw new Error("No orchestrator is running.");
      const task = await orch.createTask(randomUUID(), prompt, harness || undefined, projectId ?? null, { model: model || null });
      const done = await orch.executeTask(task.id);
      if (done.status !== "completed") throw new Error(done.output || "Agent task failed.");
      return { output: done.output, filesChanged: done.filesChanged ?? [] };
    },
    execCommand: defaultExecCommand,
    resolveProjectDir: (projectId) => orch?.resolveProjectDir(projectId) ?? process.cwd(),
    readFile: async (cwd, rel) => fs.promises.readFile(projectPath(cwd, rel), "utf8"),
    writeFile: async (cwd, rel, content) => { const p = projectPath(cwd, rel); await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, content, "utf8"); },
    globFiles: async (cwd, pattern) => globProjectFiles(cwd, pattern),
    fetchText: async (url, init) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(url, {
          method: init?.method ?? "GET",
          body: init?.body,
          headers: init?.body ? { "Content-Type": "application/json" } : undefined,
          signal: ctrl.signal,
        });
        return { status: res.status, text: (await res.text()).slice(0, 20000) };
      } finally {
        clearTimeout(timer);
      }
    },
    searchBrain: async (projectId, query, maxResults) => {
      const brain = Orchestrator.getActive()?.brainForProject(projectId ?? null);
      if (!brain) return "";
      const ctx = { taskId: "workflow-search", prompt: query } as Parameters<
        typeof brain.getPreferences
      >[0];
      const recs = [...brain.getPreferences(ctx), ...brain.getLessons(ctx)];
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
      if (terms.length === 0) return "";
      return recs
        .map((r) => {
          const hay = `${r.title} ${r.body} ${r.tags.join(" ")}`.toLowerCase();
          const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
          return { r, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.r.confidence - a.r.confidence)
        .slice(0, Math.max(1, maxResults))
        .map((x) => `- ${x.r.title}: ${x.r.body}`.slice(0, 500))
        .join("\n");
    },
    webHarness: () => {
      const names = Orchestrator.getActive()?.getHarnessNames() ?? [];
      return ["opencode", "claude-code", "codex", "pi", "gemini"].find((h) => names.includes(h)) ?? null;
    },
    destructivePatterns: [],
    requestApproval,
    resolveApproval,
  };
}