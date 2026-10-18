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
  /** Which installed harness actually drafted the graph. */
  draftedBy: string;
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

/**
 * Field guide per node kind. `!` marks required data fields; the rest fall
 * back to safe defaults. Kept in one table so the prompt and the code that
 * validates the answer can never disagree about what a kind needs.
 */
const KIND_SCHEMAS: Array<[kind: string, fields: string]> = [
  ["trigger", `!label, !triggerKind manual|cron|webhook|file-change (+cron/webhookPath/filePattern).`],
  ["agentTask", `!label, !prompt (imperative, names files/commands), harness="opencode", model="", retries=2, timeoutSec=300.`],
  ["gate", `!label, !condition. Branches carry sourceHandle true+false.`],
  ["parallel", `!label, branches 2-8. Branches MUST close at a join.`],
  ["join", `!label, waitPolicy all|any|first.`],
  ["loop", `!label, !items, maxIterations=10.`],
  ["delay", `!label, waitSec=60, waitFor?.`],
  ["subflow", `!label, !workflowName, input?.`],
  ["reviewer", `!label, !rubric (checklist). AFTER the judged step.`],
  ["chatInput", `!label, placeholder?. Conversational entries only.`],
  ["chatOutput", `!label, !message ({{vars}} ok). Terminal.`],
  ["promptTemplate", `!label, !template ({{vars}} from earlier steps).`],
  ["llmCall", `!label, !prompt (self-contained, no repo). Thinking only, not repo work.`],
  ["structuredOutput", `!label, !schema (JSON Schema string). After the step it constrains.`],
  ["note", `!label, text. Max one, never load-bearing.`],
  ["fileRead", `!label, !pattern (path/glob). First when request names files.`],
  ["fileWrite", `!label, !path, !content ({{vars}}). Approval before it when generated.`],
  ["transform", `!label, !expression (one JS expression).`],
  ["setVariable", `!label, !name, !value.`],
  ["jsonParse", `!label, !source ({{var}} with JSON), path?.`],
  ["httpRequest", `!label, !method, !url (full https), body?.`],
  ["webSearch", `!label, !query (terms, not a sentence), maxResults=5.`],
  ["urlFetch", `!label, !url (full https). Page as markdown.`],
  ["notify", `!label, !channel, !message. Near the end.`],
  ["vectorSearch", `!label, !query. Second Brain memory, NOT the web.`],
  ["approval", `!label, !instructions (what human verifies). Before fileWrite/notify/destructive.`],
  ["tool", `!label, !toolKind shell|git|http, !command (exact runnable).`],
  ["output", `!label, resultKey?. Terminal.`],
];

export function buildGeneratePrompt(
  description: string,
  maxNodes: number,
): string {
  const catalog = KIND_SCHEMAS.map(([k, s]) => `- ${k}: ${s}`).join("\n");
  return [
    "Role: Hive workflow architect. Design a COMPLETE runnable workflow. Trigger-only drafts fail.",
    "",
    "Process: 1) list concrete deliverables (files, decisions, approvals); 2) pick the smallest kind set covering them (fileRead for named files; webSearch/urlFetch for outside knowledge; agentTask for repo work; llmCall for pure thinking; reviewer after key agent work; approval before anything written/sent/destructive; fileWrite/notify/output to land results); 3) wire everything (linear chains; gate with true+false sourceHandles; parallel closed by join); 4) self-check, revise, then reply.",
    "",
    "Output (STRICT): ONLY one JSON object, no prose/fences: {\"nodes\": [{\"id\": \"n1\", \"type\": \"<kind>\", \"data\": {...}}], \"edges\": [{\"source\": \"n1\", \"target\": \"n2\"}]}. Ids sequential n1, n2… Gate edges add \"sourceHandle\": \"true\"/\"false\".",
    "",
    "Hard rules:",
    `- 3 to ${maxNodes} nodes. Exactly one trigger, first: manual unless schedule (cron), webhook (webhookPath), or file changes (filePattern) implied.`,
    "- Every non-trigger node has an incoming edge; every node except output/chatOutput/notify has an outgoing edge. sourceHandle appears ONLY on gate branch edges.",
    "- Every !required field present with CONCRETE values (real commands/paths/queries/full-sentence prompts). Never TODO/TBD/placeholder/lorem/empty required fields.",
    "- fileWrite content uses {{variables}} from upstream; approval sits between generation and fileWrite. Only catalog kinds.",
    "",
    "Anti-patterns (= failed draft): trigger-only; unwired nodes; gate missing a branch; parallel without join; empty fileWrite path; sentence-long webSearch query; agentTask for pure summarising.",
    "",
    "Catalog (! = required):",
    catalog,
    "",
    "Example 1 (nightly sweep, parallel closed by join):",
    '{"nodes": [{"id": "n1", "type": "trigger", "data": {"label": "Nightly", "triggerKind": "cron", "cron": "0 2 * * *"}}, {"id": "n2", "type": "parallel", "data": {"label": "Fan out", "branches": 2}}, {"id": "n3", "type": "agentTask", "data": {"label": "Run tests", "harness": "opencode", "model": "", "prompt": "Run pnpm test. Summarize each failing suite with file:line.", "retries": 1, "timeoutSec": 600}}, {"id": "n4", "type": "tool", "data": {"label": "Lint", "toolKind": "shell", "command": "pnpm lint"}}, {"id": "n5", "type": "join", "data": {"label": "Join", "waitPolicy": "all"}}], "edges": [{"source": "n1", "target": "n2"}, {"source": "n2", "target": "n3"}, {"source": "n2", "target": "n4"}, {"source": "n3", "target": "n5"}, {"source": "n4", "target": "n5"}]}',
    "",
    "Example 2 (research digest, approval before fileWrite):",
    '{"nodes": [{"id": "n1", "type": "trigger", "data": {"label": "Trigger", "triggerKind": "manual"}}, {"id": "n2", "type": "fileRead", "data": {"label": "Read notes", "pattern": "research/**/*.md"}}, {"id": "n3", "type": "webSearch", "data": {"label": "Search", "query": "\\"local LLM\\" observability", "maxResults": 5}}, {"id": "n4", "type": "agentTask", "data": {"label": "Digest", "harness": "opencode", "model": "", "prompt": "Rank 5 blog topics from notes+hits. Each: title, why now, questions, links.", "retries": 2, "timeoutSec": 300}}, {"id": "n5", "type": "approval", "data": {"label": "Approve", "approver": "", "instructions": "Pick the topic. Reject if links missing."}}, {"id": "n6", "type": "fileWrite", "data": {"label": "Save PRD", "path": "research/prd.md", "content": "# PRD\\n\\n{{digest}}"}}], "edges": [{"source": "n1", "target": "n2"}, {"source": "n2", "target": "n3"}, {"source": "n3", "target": "n4"}, {"source": "n4", "target": "n5"}, {"source": "n5", "target": "n6"}]}',
    "",
    "Checklist: 3+ nodes, one trigger first, required fields concrete, all wired (gate true+false), join closes parallel, approval before fileWrite, JSON only.",
    "",
    `Request: ${description}`,
  ].join("\n");
}

/**
 * A draft with no working steps (trigger alone, or trigger + notes) is not
 * a short workflow — it is the model declining the task. Callers retry with
 * a sterner reminder, then fail honestly instead of previewing nothing.
 */
export function isDegenerateGraph(nodes: Array<{ type: string }>): boolean {
  const working = nodes.filter((n) => n.type !== "trigger" && n.type !== "note");
  return working.length === 0;
}

/** Server-side twin of the client's sanitize: ids, kinds, cap, wiring. */
export function coerceGeneratedGraph(
  raw: unknown,
  maxNodes: number,
  draftedBy = "unknown",
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

  // Models overgeneralize the gate-branch handle onto linear edges, and
  // React Flow cannot anchor an edge to a handle id no node declares — the
  // whole edge silently vanishes. So handles survive only on gate true/false
  // branches, and duplicate pairs collapse (one id per edge is structural).
  const typeById = new Map(nodes.map((n) => [n.id, n.type]));
  const edges: GeneratedEdge[] = [];
  const pairs = new Set<string>();
  let droppedHandles = 0;
  let droppedDupes = 0;
  for (const entry of rawEdges) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const source = typeof e.source === "string" ? e.source : "";
    const target = typeof e.target === "string" ? e.target : "";
    if (!seen.has(source) || !seen.has(target)) continue;
    const pair = `${source}>${target}`;
    if (pairs.has(pair)) {
      droppedDupes++;
      continue;
    }
    pairs.add(pair);
    const handle = typeof e.sourceHandle === "string" ? e.sourceHandle : "";
    const keepHandle =
      typeById.get(source) === "gate" &&
      (handle === "true" || handle === "false");
    if (handle && !keepHandle) droppedHandles++;
    edges.push({
      id: `e-${source}-${target}`,
      source,
      target,
      ...(keepHandle ? { sourceHandle: handle } : {}),
      type: "smoothstep",
    });
  }
  if (droppedHandles > 0) {
    warnings.push(
      `Dropped ${droppedHandles} bogus edge handle(s) — only gate branches use source handles.`,
    );
  }
  if (droppedDupes > 0) {
    warnings.push(`Dropped ${droppedDupes} duplicate edge(s).`);
  }
  // Chain unwired nodes in order so the result is always a runnable line —
  // the user rearranges from something valid, not from fragments.
  const hasIn = new Set(edges.map((e) => e.target));
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    const pair = `${a.id}>${b.id}`;
    if (!hasIn.has(b.id) && !pairs.has(pair)) {
      edges.push({
        id: `e-${a.id}-${b.id}`,
        source: a.id,
        target: b.id,
        type: "smoothstep",
      });
      pairs.add(pair);
      hasIn.add(b.id);
    }
  }

  return { nodes, edges, warnings, draftedBy };
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
  // configured harness leads and the rest follow as fallbacks. Drafting is
  // provider-agnostic thinking, so a 500 from one CLI is not a verdict on
  // the request — the next installed CLI gets the same prompt.
  let firstId: string | null = null;
  let modelRef = "";
  if (input.model) {
    const resolved = await resolveModelRef(input.model);
    if (resolved) {
      firstId = resolved.harness;
      modelRef = resolved.ref;
    }
  }
  if (!firstId && input.harness && harnesses.has(input.harness)) {
    firstId = input.harness;
  }
  if (!firstId) {
    const preferred = config.routing?.default;
    firstId =
      preferred && harnesses.has(preferred) ? preferred : (
        harnesses.keys().next().value ?? null
      );
  }
  const ordered = [
    ...(firstId ? [firstId] : []),
    ...[...harnesses.keys()].filter((id) => id !== firstId),
  ];
  if (ordered.length === 0) {
    throw new GenerateError(
      503,
      "No harness is installed to draft the workflow. Install a CLI first.",
    );
  }

  const prompt = buildGeneratePrompt(description, maxNodes);
  const failures: string[] = [];
  for (const harnessId of ordered) {
    const harness = harnesses.get(harnessId);
    if (!harness) continue;
    // A pinned model ref belongs to the harness that understands it; other
    // harnesses draft with their own default rather than a foreign flag.
    const effectiveModel =
      harnessId === firstId && modelRef ? modelRef : "";
    const attempts = [
      prompt,
      `${prompt}\nReminder: reply with ONLY the JSON object. A trigger alone is a failed draft — include 3+ wired working steps with concrete field values.`,
    ];
    for (const attempt of attempts) {
      let output: string;
      try {
        const result = await harness.execute(attempt, {
        ...(effectiveModel ? { model: effectiveModel } : {}),
        // Local models draft slowly (60s+ observed); cloud CLIs fail fast,
        // so a generous ceiling costs nothing on the failure paths.
        timeout: 60000,
        cwd: generateScratchDir(),
      });
        if (!result.success || !result.output) {
          failures.push(describeFailure(harnessId, result));
          break;
        }
        output = result.output;
      } catch (err) {
        failures.push(
          `${harnessId}: ${oneLine(err instanceof Error ? err.message : String(err))}`,
        );
        break;
      }
      const parsed = extractJsonObject(output);
      if (!parsed) {
        failures.push(`${harnessId}: reply was not JSON: ${oneLine(output)}`);
        continue;
      }
      const graph = coerceGeneratedGraph(parsed, maxNodes, harnessId);
      if (isDegenerateGraph(graph.nodes)) {
        failures.push(`${harnessId}: draft had no working steps`);
        continue;
      }
      return graph;
    }
  }
  throw new GenerateError(
    422,
    `No harness could draft a workflow (tried ${ordered.join(", ")}): ${failures.join("; ")}. Fix the CLI, or pick another harness preference.`,
  );
}

/** First stderr/output line, capped — enough to act on, never a dump. */
function oneLine(value: string): string {
  return value.split("\n")[0].slice(0, 150).trim() || "(no output)";
}

function describeFailure(
  harnessId: string,
  result: { stderr?: string; output?: string; timedOut?: boolean },
): string {
  if (result.timedOut) return `${harnessId}: timed out after 30s`;
  const text = result.stderr || result.output || "";
  return `${harnessId}: ${oneLine(text)}`;
}
