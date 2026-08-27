/**
 * What each harness is actually *for*.
 *
 * The keyword rules table says "a prompt containing `test` goes to
 * opencode". That is a statement about the prompt, not about opencode. This
 * file is the other half: a description of each CLI good enough that a model
 * asked "which of these should do this job?" can answer without a lookup
 * table — which is what makes routing dynamic rather than a regex cascade.
 *
 * These are also what the Settings screen shows beside each harness, so they
 * are written for a person to read, not only for a prompt to consume.
 */
export interface HarnessProfile {
  id: string;
  label: string;
  /** Default binary name on PATH. */
  command: string;
  /** One line, present tense: what this CLI is. */
  summary: string;
  /** Where it is the best available choice. */
  strengths: string[];
  /** Where it is the wrong choice — as load-bearing as the strengths. */
  limits: string[];
  /** Whether it emits a parseable event stream (tool calls, tokens). */
  structuredEvents: boolean;
  /** Whether a per-run `--model` is meaningful for it. */
  modelSelectable: boolean;
}

export const HARNESS_PROFILES: Record<string, HarnessProfile> = {
  opencode: {
    id: "opencode",
    label: "opencode",
    command: "opencode",
    summary:
      "Provider-agnostic coding agent with the broadest model catalogue of any CLI here.",
    strengths: [
      "running a specific model from any provider (its catalogue is the widest)",
      "test writing and test repair",
      "build, CI and infrastructure work",
      "research and codebase exploration",
    ],
    limits: [
      "resolves its workspace independently of the spawn directory, so it must be given --dir",
    ],
    structuredEvents: true,
    modelSelectable: true,
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    command: "claude",
    summary:
      "Anthropic's agent, strongest on long multi-file reasoning and careful edits.",
    strengths: [
      "large refactors spanning many files",
      "understanding an unfamiliar codebase before changing it",
      "documentation and prose",
      "work where getting it right matters more than getting it fast",
    ],
    limits: ["Anthropic models only", "no way to list its own models"],
    structuredEvents: true,
    modelSelectable: true,
  },
  pi: {
    id: "pi",
    label: "pi",
    command: "pi",
    summary:
      "Lightweight multi-provider agent that starts fast and reports thinking cleanly.",
    strengths: [
      "short, well-scoped edits",
      "quick questions where startup cost dominates",
      "switching provider per run",
    ],
    limits: ["less capable than the heavier agents on sprawling tasks"],
    structuredEvents: true,
    modelSelectable: true,
  },
  codex: {
    id: "codex",
    label: "Codex",
    command: "codex",
    summary:
      "OpenAI's agent, sandboxed by default and unusually strong at algorithmic work.",
    strengths: [
      "algorithms, data structures and tricky pure logic",
      "debugging a failure whose cause is not yet known",
      "competitive-programming-shaped problems",
    ],
    limits: [
      "OpenAI models only",
      "its sandbox may refuse network or out-of-tree writes",
    ],
    structuredEvents: true,
    modelSelectable: true,
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    summary:
      "Google's agent, with the largest context window available here and a generous free tier.",
    strengths: [
      "tasks that need a very large amount of context at once",
      "summarising or auditing a whole repository",
      "multimodal input",
    ],
    limits: [
      "buffers its whole run before reporting, so the activity trail fills in at the end",
      "Gemini models only",
    ],
    structuredEvents: true,
    modelSelectable: true,
  },
  qwen: {
    id: "qwen",
    label: "Qwen Code",
    command: "qwen",
    summary:
      "Gemini CLI's fork wired to Qwen models — a capable free-tier option for bulk work.",
    strengths: [
      "high-volume mechanical edits where cost per run matters",
      "code generation from a clear specification",
    ],
    limits: ["Qwen models only", "same end-of-run reporting as Gemini CLI"],
    structuredEvents: true,
    modelSelectable: true,
  },
  "cursor-agent": {
    id: "cursor-agent",
    label: "Cursor Agent",
    command: "cursor-agent",
    summary:
      "The headless half of Cursor, with its codebase indexing behind it.",
    strengths: [
      "changes that need to find their own blast radius across a large repo",
      "matching an existing codebase's conventions",
    ],
    limits: ["needs a Cursor account", "models are whatever that plan offers"],
    structuredEvents: true,
    modelSelectable: true,
  },
  aider: {
    id: "aider",
    label: "aider",
    command: "aider",
    summary:
      "Git-native pair programmer that edits by diff against named files.",
    strengths: [
      "surgical edits to files you can already name",
      "working against any provider LiteLLM supports",
    ],
    limits: [
      "no structured event stream — the trail is plain text",
      "weaker at open-ended exploration than the agentic CLIs",
    ],
    structuredEvents: false,
    modelSelectable: true,
  },
  amp: {
    id: "amp",
    label: "Amp",
    command: "amp",
    summary:
      "Sourcegraph's agent, which picks its own model per step and runs long tasks unattended.",
    strengths: [
      "long autonomous tasks you do not want to babysit",
      "work spanning many files with sub-agents of its own",
    ],
    limits: ["no model selection", "no structured event stream"],
    structuredEvents: false,
    modelSelectable: false,
  },
  goose: {
    id: "goose",
    label: "goose",
    command: "goose",
    summary:
      "Block's extensible agent, strongest when the job needs MCP tooling.",
    strengths: [
      "tasks needing external tools or MCP servers",
      "machine and environment automation beyond the repository",
    ],
    limits: [
      "model comes from its profile, not the command line",
      "no structured event stream",
    ],
    structuredEvents: false,
    modelSelectable: false,
  },
  crush: {
    id: "crush",
    label: "Crush",
    command: "crush",
    summary: "Charm's fast multi-provider agent for short interactive work.",
    strengths: ["quick edits", "one-shot questions about the code"],
    limits: ["no structured event stream", "not aimed at long tasks"],
    structuredEvents: false,
    modelSelectable: false,
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot CLI",
    command: "copilot",
    summary:
      "GitHub's agent, at home in GitHub-shaped work — issues, PRs, Actions.",
    strengths: [
      "anything touching GitHub itself: issues, pull requests, workflows",
      "repositories whose conventions Copilot already knows",
    ],
    limits: [
      "needs --allow-all-tools to run headlessly, so prefer it in a worktree",
      "no structured event stream",
    ],
    structuredEvents: false,
    modelSelectable: true,
  },
};

/** The profile for a harness, or a neutral one for anything unregistered. */
export function harnessProfile(id: string): HarnessProfile {
  return (
    HARNESS_PROFILES[id] ?? {
      id,
      label: id,
      command: id,
      summary: "General-purpose coding agent.",
      strengths: [],
      limits: [],
      structuredEvents: false,
      modelSelectable: true,
    }
  );
}

/**
 * The profiles rendered for a routing prompt. Kept here rather than in the
 * router so that the description a model reads and the description a person
 * reads in Settings can never drift apart.
 */
export function describeHarnesses(ids: string[]): string {
  return ids
    .map((id) => {
      const p = harnessProfile(id);
      const lines = [`- ${p.id} — ${p.summary}`];
      if (p.strengths.length) {
        lines.push(`    best at: ${p.strengths.join("; ")}`);
      }
      if (p.limits.length) {
        lines.push(`    avoid when: ${p.limits.join("; ")}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}
