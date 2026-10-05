import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Harness } from "@hive/shared/harness";
import type { Config } from "../config";
import { extractJsonObject } from "../llmJson";
import { resolveModelRef } from "../models/catalog";

/**
 * Describe-in-text → workflow graph, served from POST /api/workflows/generate.
 *
 * Reuses the same machinery as Router.llmRoute (a real harness asked in a
 * scratch dir, JSON fished out with extractJsonObject) without depending on
 * the Router class: generation is classification-plus-synthesis, not
 * routing, and it must keep working when routing is disabled.
 */

export interface GenerateRequest {
  description: string;
  harness?: string;
  model?: string;
  maxNodes?: number;
}

export interface GeneratedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface GeneratedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
}

export interface GenerateResponse {
  nodes: GeneratedNode[];
  edges: GeneratedEdge[];
  warnings: string[];
}

export class GenerateError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every kind the generator may emit. Mirrors the client registry. */
export const GENERATABLE_KINDS: ReadonlySet<string> = new Set([
  "trigger",
  "agentTask",
  "gate",
  "parallel",
  "join",
  "approval",
  "tool",
  "output",
  "loop",
  "delay",
  "subflow",
  "reviewer",
  "chatInput",
  "chatOutput",
  "promptTemplate",
  "llmCall",
  "structuredOutput",
  "note",
  "fileRead",
  "fileWrite",
  "transform",
  "setVariable",
  "jsonParse",
  "httpRequest",
  "webSearch",
  "urlFetch",
  "notify",
  "vectorSearch",
]);

const KIND_SCHEMAS: Array<[string, string]> = [
  ["trigger", `{label, triggerKind: manual|cron|webhook|file-change}`],
  ["agentTask", `{label, harness, model?, prompt, retries?, timeoutSec?}`],
  ["gate", `{label, condition}`],
  ["parallel", `{label, branches: 2-8}`],
  ["join", `{label, waitPolicy: all|any|first}`],
  ["loop", `{label, items, maxIterations?}`],
  ["delay", `{label, waitSec, waitFor?}`],
  ["subflow", `{label, workflowName, input?}`],
  ["reviewer", `{label, harness, model?, rubric}`],
  ["chatInput", `{label, placeholder?}`],
  ["chatOutput", `{label, message}`],
  ["promptTemplate", `{label, template with {{variables}}`],
  ["llmCall", `{label, harness, model?, prompt}`],
  ["structuredOutput", `{label, schema (JSON Schema)}`],
  ["note", `{label, text}`],
  ["fileRead", `{label, pattern (path or glob)}`],
  ["fileWrite", `{label, path, content}`],
  ["transform", `{label, expression}`],
  ["setVariable", `{label, name, value}`],
  ["jsonParse", `{label, source, path?}`],
  ["httpRequest", `{label, method, url, body?}`],
  ["webSearch", `{label, query, maxResults?}`],
  ["urlFetch", `{label, url}`],
  ["notify", `{label, channel, message}`],
  ["vectorSearch", `{label, query, maxResults?}`],
  ["approval", `{label, approver?, instructions?}`],
  ["tool", `{label, toolKind: shell|git|http, command}`],
  ["output", `{label, resultKey?}`],
];

export function buildGeneratePrompt(
  description: string,
  maxNodes: number,
): string {
  const catalog = KIND_SCHEMAS.map(([k, s]) => `- ${k}: data is ${s}`).join(
    "\n",
  );
  return [
    "You design Hive workflows. Reply with ONLY a JSON object, no prose.",
    `Schema: {"nodes": [{"id": "n1", "type": "<kind>", "data": {...}}], "edges": [{"source": "n1", "target": "n2"}]}`,
    "Rules:",
    `- At most ${maxNodes} nodes. Always start with exactly one trigger node (manual unless the request implies cron/webhook/file-change).`,
    "- Every node except the trigger needs an incoming edge; every node except output/chatOutput needs an outgoing edge (gate needs true+false branches).",
    "- Prefer agentTask for repo work, reviewer after important agent steps, approval before fileWrite/destructive steps.",
    "- Node kinds and their data shapes:",
    catalog,
    "Example 1 (nightly test sweep):",
    '{"nodes": [{"id": "n1", "type": "trigger", "data": {"label": "Nightly", "triggerKind": "cron", "cron": "0 2 * * *"}}, {"id": "n2", "type": "parallel", "data": {"label": "Fan out", "branches": 2}}, {"id": "n3", "type": "agentTask", "data": {"label": "Run tests", "harness": "opencode", "model": "", "prompt": "Run the test suite and summarize failures", "retries": 1, "timeoutSec": 600}}, {"id": "n4", "type": "tool", "data": {"label": "Lint", "toolKind": "shell", "command": "pnpm lint"}}, {"id": "n5", "type": "join", "data": {"label": "Join", "waitPolicy": "all"}}], "edges": [{"source": "n1", "target": "n2"}, {"source": "n2", "target": "n3"}, {"source": "n2", "target": "n4"}, {"source": "n3", "target": "n5"}, {"source": "n4", "target": "n5"}]}',
    "Example 2 (research digest with approval gate):",
    '{"nodes": [{"id": "n1", "type": "trigger", "data": {"label": "Trigger", "triggerKind": "manual"}}, {"id": "n2", "type": "webSearch", "data": {"label": "Search", "query": "local LLM observability", "maxResults": 5}}, {"id": "n3", "type": "agentTask", "data": {"label": "Digest", "harness": "opencode", "model": "", "prompt": "Summarize the search hits into a digest", "retries": 2, "timeoutSec": 300}}, {"id": "n4", "type": "approval", "data": {"label": "Approve", "approver": "", "instructions": "Check the digest before it is saved"}}, {"id": "n5", "type": "fileWrite", "data": {"label": "Save digest", "path": "digest.md", "content": "{{digest}}"}}], "edges": [{"source": "n1", "target": "n2"}, {"source": "n2", "target": "n3"}, {"source": "n3", "target": "n4"}, {"source": "n4", "target": "n5"}]}',
    `Request: ${description}`,
  ].join("\n");
}

/** Server-side twin of the client's sanitize: ids, kinds, cap, wiring. */
export function coerceGeneratedGraph(
  raw: unknown,
  maxNodes: number,
): GenerateResponse {
  const warnings: string[] = [];
  const cap = Math.min(10, Math.max(4, Math.floor(maxNodes) || 8));
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: GeneratedNode[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of rawNodes.entries()) {
    if (nodes.length >= cap) {
      warnings.push(`Capped at ${cap} nodes; the rest were dropped.`);
      break;
    }
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const type = typeof e.type === "string" ? e.type : "";
    if (!GENERATABLE_KINDS.has(type)) {
      warnings.push(
        `Dropped unknown node kind "${type || "(missing)"}"; add it as a NEW block or rephrase the request.`,
      );
      continue;
    }
    let id = typeof e.id === "string" && e.id ? e.id : `n${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const data =
      e.data && typeof e.data === "object"
        ? (e.data as Record<string, unknown>)
        : {};
    if (typeof data.label !== "string" || !data.label) {
      data.label = labelFor(type);
    }
    nodes.push({
      id,
      type,
      position: { x: (nodes.length % 4) * 280, y: Math.floor(nodes.length / 4) * 160 },
      data,
    });
  }

  if (!nodes.some((n) => n.type === "trigger")) {
    const id = `gen-trigger`;
    nodes.unshift({
      id,
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { label: "Trigger", triggerKind: "manual" },
    });
    seen.add(id);
    warnings.push("No trigger was generated; a Manual trigger was added.");
    // The cap counts total nodes, so synthesis can push past it.
    while (nodes.length > cap) {
      const dropped = nodes.pop();
      seen.delete(dropped!.id);
    }
  }

  const edges: GeneratedEdge[] = [];
  for (const entry of rawEdges) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const source = typeof e.source === "string" ? e.source : "";
    const target = typeof e.target === "string" ? e.target : "";
    if (!seen.has(source) || !seen.has(target)) continue;
    edges.push({
      id: `e-${source}-${target}`,
      source,
      target,
      ...(typeof e.sourceHandle === "string"
        ? { sourceHandle: e.sourceHandle }
        : {}),
      type: "smoothstep",
    });
  }
  // Chain unwired nodes in order so the result is always a runnable line —
  // the user rearranges from something valid, not from fragments.
  const hasIn = new Set(edges.map((e) => e.target));
  const hasOut = new Set(edges.map((e) => e.source));
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (!hasOut.has(a.id) && !hasIn.has(b.id)) {
      edges.push({ id: `e-${a.id}-${b.id}`, source: a.id, target: b.id, type: "smoothstep" });
      hasOut.add(a.id);
      hasIn.add(b.id);
    }
  }

  return { nodes, edges, warnings };
}

function labelFor(kind: string): string {
  const found = KIND_SCHEMAS.find(([k]) => k === kind);
  if (!found) return kind;
  return kind
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());
}

let deps: { config: Config; harnesses: Map<string, Harness> } | null = null;

/** Setter injection — same pattern as setSharedMemory for /api/memory. */
export function setGenerateDeps(d: {
  config: Config;
  harnesses: Map<string, Harness>;
}): void {
  deps = d;
}

let scratchDir: string | null = null;

function generateScratchDir(): string {
  if (scratchDir) return scratchDir;
  const dir = path.join(os.tmpdir(), "hive-workflow-generate");
  try {
    fs.mkdirSync(dir, { recursive: true });
    scratchDir = dir;
  } catch {
    scratchDir = os.tmpdir();
  }
  return scratchDir;
}

export async function generateWorkflowGraph(
  input: GenerateRequest,
): Promise<GenerateResponse> {
  if (!deps) throw new GenerateError(503, "Workflow generation is not wired up.");
  const description = input.description?.trim() ?? "";
  if (!description) throw new GenerateError(400, "Describe the workflow first.");
  if (description.length > 2000) {
    throw new GenerateError(400, "Keep the description under 2000 characters.");
  }
  const maxNodes = Math.min(10, Math.max(4, Math.floor(input.maxNodes ?? 8) || 8));
  const { config, harnesses } = deps;

  // Model first: an explicit catalog ref pins harness + model, a bare
  // harness pins the CLI with its default, otherwise the preferred
  // configured harness (or the first available one) does the drafting.
  let harnessId: string | null = null;
  let modelRef = "";
  if (input.model) {
    const resolved = await resolveModelRef(input.model);
    if (resolved) {
      harnessId = resolved.harness;
      modelRef = resolved.ref;
    }
  }
  if (!harnessId && input.harness && harnesses.has(input.harness)) {
    harnessId = input.harness;
  }
  if (!harnessId) {
    const preferred = config.routing?.default;
    harnessId =
      (preferred && harnesses.has(preferred) ? preferred : null) ??
      harnesses.keys().next().value ??
      null;
  }
  const harness = harnessId ? harnesses.get(harnessId) : undefined;
  if (!harness || !harnessId) {
    throw new GenerateError(
      503,
      "No harness is installed to draft the workflow. Install a CLI first.",
    );
  }

  const prompt = buildGeneratePrompt(description, maxNodes);
  const attempts = [prompt, `${prompt}\nReminder: reply with ONLY the JSON object.`];
  let lastExcerpt = "";
  for (const attempt of attempts) {
    let output: string;
    try {
      const result = await harness.execute(attempt, {
        ...(modelRef ? { model: modelRef } : {}),
        timeout: 30000,
        cwd: generateScratchDir(),
      });
      if (!result.success || !result.output) continue;
      output = result.output;
    } catch {
      continue;
    }
    const parsed = extractJsonObject(output);
    if (!parsed) {
      lastExcerpt = output.slice(0, 200);
      continue;
    }
    return coerceGeneratedGraph(parsed, maxNodes);
  }
  throw new GenerateError(
    422,
    `The model did not return a usable workflow${lastExcerpt ? `: ${lastExcerpt}` : "."} Try again or shorten the description.`,
  );
}
