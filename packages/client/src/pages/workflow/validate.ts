import type { HiveEdge, HiveNode, HiveNodeKind } from "./types";

/**
 * Forward-compat guard: flows saved by a newer client (or hand-edited) may
 * reference kinds this build has no card for. Warn rather than crash — the
 * canvas renders unknown nodes through React Flow's default, and validation
 * must never be the thing that breaks the page.
 */
const KNOWN_KINDS: ReadonlySet<string> = new Set<string>([
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
] satisfies readonly HiveNodeKind[]);

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  message: string;
  nodeId?: string;
}

/**
 * Flags the things an executor would choke on: no trigger, disconnected
 * nodes, gate branches left unwired, and cycles. Runs client-side so the
 * builder can surface actionable messages as you edit, not just a red
 * outline.
 */
export function validateWorkflow(
  nodes: HiveNode[],
  edges: HiveEdge[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (nodes.length === 0) return issues;

  if (!nodes.some((n) => n.type === "trigger")) {
    issues.push({
      id: "missing-trigger",
      severity: "error",
      message: "No trigger — add one so the workflow knows how to start.",
    });
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    outgoing.set(n.id, 0);
  }
  for (const e of edges) {
    if (incoming.has(e.target))
      incoming.set(e.target, incoming.get(e.target)! + 1);
    if (outgoing.has(e.source))
      outgoing.set(e.source, outgoing.get(e.source)! + 1);
  }

  for (const n of nodes) {
    const label = n.data.label || n.id;
    const inCount = incoming.get(n.id) ?? 0;
    const outCount = outgoing.get(n.id) ?? 0;

    if (n.type === "trigger") {
      if (outCount === 0) {
        issues.push({
          id: `no-out-${n.id}`,
          severity: "warning",
          message: `"${label}" isn't connected to anything.`,
          nodeId: n.id,
        });
      }
      continue;
    }

    if (n.type === "output") {
      if (inCount === 0) {
        issues.push({
          id: `disconnected-${n.id}`,
          severity: "warning",
          message: `"${label}" is disconnected from the workflow.`,
          nodeId: n.id,
        });
      }
      continue;
    }

    if (inCount === 0) {
      issues.push({
        id: `no-in-${n.id}`,
        severity: "error",
        message: `"${label}" has no incoming connection.`,
        nodeId: n.id,
      });
    }
    if (outCount === 0) {
      issues.push({
        id: `no-out-${n.id}`,
        severity: "warning",
        message: `"${label}" doesn't lead anywhere.`,
        nodeId: n.id,
      });
    }
  }

  for (const n of nodes) {
    const label = n.data.label || n.id;
    const data = n.data as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    if (n.type === "fileWrite" && !str(data.path).trim()) {
      issues.push({
        id: `no-path-${n.id}`,
        severity: "error",
        message: `"${label}" needs a file path to write to.`,
        nodeId: n.id,
      });
    }
    if (n.type === "loop" && !str(data.items).trim()) {
      issues.push({
        id: `no-items-${n.id}`,
        severity: "error",
        message: `"${label}" needs items to loop over.`,
        nodeId: n.id,
      });
    }
    if (n.type === "subflow" && !str(data.workflowName).trim()) {
      issues.push({
        id: `no-workflow-${n.id}`,
        severity: "error",
        message: `"${label}" needs a workflow name to call.`,
        nodeId: n.id,
      });
    }
    if (n.type === "llmCall" && !str(data.prompt).trim()) {
      issues.push({
        id: `no-prompt-${n.id}`,
        severity: "warning",
        message: `"${label}" has no prompt yet.`,
        nodeId: n.id,
      });
    }
    if (n.type === "promptTemplate") {
      const template = str(data.template);
      const opens = (template.match(/\{\{/g) ?? []).length;
      const closes = (template.match(/\}\}/g) ?? []).length;
      if (opens !== closes) {
        issues.push({
          id: `unclosed-var-${n.id}`,
          severity: "warning",
          message: `"${label}" has an unclosed {{ variable.`,
          nodeId: n.id,
        });
      }
    }
  }

  for (const n of nodes) {
    if (!KNOWN_KINDS.has(n.type)) {
      issues.push({
        id: `unknown-kind-${n.id}`,
        severity: "warning",
        message: `"${n.data.label || n.id}" is a "${n.type}" node this version doesn't know — it won't run.`,
        nodeId: n.id,
      });
    }
  }

  for (const n of nodes.filter((n) => n.type === "gate")) {
    const branchesUsed = new Set(
      edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle),
    );
    const label = n.data.label || n.id;
    if (!branchesUsed.has("true")) {
      issues.push({
        id: `gate-true-${n.id}`,
        severity: "error",
        message: `"${label}" has no branch connected for True.`,
        nodeId: n.id,
      });
    }
    if (!branchesUsed.has("false")) {
      issues.push({
        id: `gate-false-${n.id}`,
        severity: "error",
        message: `"${label}" has no branch connected for False.`,
        nodeId: n.id,
      });
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    if (adjacency.has(e.source)) adjacency.get(e.source)!.push(e.target);
  }
  const color = new Map<string, 0 | 1 | 2>();
  const cycleNodes = new Set<string>();
  const dfs = (id: string, stack: string[]) => {
    color.set(id, 1);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        const idx = stack.indexOf(next);
        for (const s of stack.slice(idx)) cycleNodes.add(s);
        continue;
      }
      if (c === 0) dfs(next, stack);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const n of nodes) {
    if ((color.get(n.id) ?? 0) === 0) dfs(n.id, []);
  }
  if (cycleNodes.size > 0) {
    issues.push({
      id: "cycle",
      severity: "error",
      message: `The workflow has a cycle involving ${cycleNodes.size} node${
        cycleNodes.size === 1 ? "" : "s"
      } — it would loop forever.`,
    });
  }

  return issues;
}
