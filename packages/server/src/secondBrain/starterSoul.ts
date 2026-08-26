import { harnessProfile } from "../harnesses/profiles";
import type { BrainScope } from "./types";

/**
 * The soul.md a new install (or a newly added project) starts from.
 *
 * A blank template is honest but useless: it asks the user to describe how
 * they work before they have worked, and until they do, routing has nothing
 * to go on. So the first file is *seeded* from what this machine actually
 * has — the CLIs that are installed, what each is for, and the model chosen
 * to route with — and written in the same format the user will later edit
 * by hand and the learning agent will later append to.
 *
 * That makes soul.md the routing configuration from the first task, rather
 * than a file that becomes useful only after weeks of observation.
 *
 * Two audiences, one file. A person reads the prose; the router reads the
 * `category → harness` lines and the `Router model:` line. Keeping both in
 * one place is deliberate: a routing rule the user cannot see and edit is
 * how the old keyword table became something nobody trusted.
 */

/** The section the router reads. Named here so parser and writer agree. */
export const ROUTING_SECTION = "Harness preferences";

/** The line in that section naming the model that decides routing. */
export const ROUTER_MODEL_LABEL = "Router model";

export interface StarterSoulInput {
  scope: BrainScope;
  /** Harness ids that are installed and enabled, in preference order. */
  harnesses: string[];
  /** Catalog id of the model chosen to route with. Empty = automatic. */
  routerModel: string;
  /** Project name, for a project-scoped file. */
  projectName?: string;
}

/**
 * Sensible opening routes, given what is actually installed.
 *
 * These are a starting point the user is expected to overrule, not a claim
 * about which CLI is best. Each category picks the first installed harness
 * whose profile claims that kind of work, and falls back to the first
 * installed one — so a machine with a single CLI gets a coherent file
 * rather than a table of blanks.
 */
const CATEGORY_PREFERENCES: Record<string, string[]> = {
  test: ["opencode", "codex", "claude-code", "pi"],
  refactor: ["claude-code", "cursor-agent", "opencode", "aider"],
  docs: ["claude-code", "gemini", "opencode", "pi"],
  devops: ["opencode", "goose", "codex", "claude-code"],
  ui: ["claude-code", "cursor-agent", "opencode"],
  research: ["gemini", "opencode", "claude-code", "pi"],
  bugfix: ["codex", "claude-code", "opencode", "pi"],
  feature: ["claude-code", "opencode", "codex", "cursor-agent"],
};

/** The first installed harness from a preference list, else the first at all. */
function pick(preferences: string[], available: string[]): string | null {
  for (const id of preferences) {
    if (available.includes(id)) return id;
  }
  return available[0] ?? null;
}

/** Opening `category → harness` routes for the harnesses on this machine. */
export function suggestedRoutes(harnesses: string[]): Array<[string, string]> {
  if (harnesses.length === 0) return [];
  const routes: Array<[string, string]> = [];
  for (const [category, preferences] of Object.entries(CATEGORY_PREFERENCES)) {
    const chosen = pick(preferences, harnesses);
    if (chosen) routes.push([category, chosen]);
  }
  return routes;
}

export function buildStarterSoul(input: StarterSoulInput): string {
  const { scope, harnesses, routerModel, projectName } = input;

  const scopeLine =
    scope === "global"
      ? "Applies to every project on this machine."
      : `Applies to ${projectName ? `**${projectName}**` : "this repository"}, and overrides the global soul.`;

  const lines: string[] = [
    "# Soul",
    "",
    scopeLine,
    "Agents read this file on demand — it is not a system prompt.",
    "Edit it freely; Hive only ever appends entries you have approved.",
    "",
    `## ${ROUTING_SECTION}`,
    "",
    "<!--",
    "  Hive routes work by reading this section first.",
    "",
    `  \`${ROUTER_MODEL_LABEL}: <id>\` names the model that decides routing.`,
    "  Leave it blank and Hive picks a small, fast model on its own.",
    "",
    "  `<category> → <harness>` pins a kind of work to one CLI. Delete a line",
    "  to hand that category back to the router's judgement; anything not",
    "  pinned here is decided by the router reading the task.",
    "",
    "  Plain sentences in this section are read too — they are passed to the",
    '  router as your preferences, so "prefer local models after midnight"',
    '  or "never use amp for anything touching migrations" both work.',
    "-->",
    "",
    `- ${ROUTER_MODEL_LABEL}: ${routerModel || "(automatic)"}`,
  ];

  for (const [category, harness] of suggestedRoutes(harnesses)) {
    lines.push(`- ${category} → ${harness}`);
  }

  if (harnesses.length > 0) {
    lines.push("", "<!-- What Hive found on this machine:");
    for (const id of harnesses) {
      const profile = harnessProfile(id);
      lines.push(
        `     ${profile.label} (${profile.command}) — ${profile.summary}`,
      );
    }
    lines.push("-->");
  } else {
    lines.push(
      "",
      "<!-- No agent CLI was found on this machine when this file was written.",
      "     Install one and run `hive doctor`, then edit the routes above. -->",
    );
  }

  const remaining: Array<[string, string]> = [
    ["Writing style", "How I want prose, commits and docs to read."],
    ["Document preferences", "Markdown conventions, structure, heading style."],
    ["Ideation patterns", "How I like to think a problem through."],
    ["Skill choices", "Which tools and skills I reach for, and which I skip."],
    ["UI preferences", "Layout, density, colour, what I want on screen."],
  ];

  for (const [heading, hint] of remaining) {
    lines.push("", `## ${heading}`, "", `<!-- ${hint} -->`);
  }

  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Reading it back                                                     */
/* ------------------------------------------------------------------ */

export interface SoulRoutingGuidance {
  /** Catalog id the user wants routing decided by. Empty = automatic. */
  routerModel: string;
  /** Explicit `category → harness` pins, lowercased category keys. */
  routes: Record<string, string>;
  /** Free-text preferences, handed to the router as context. */
  notes: string[];
}

/**
 * Reads the routing section out of one or more souls.
 *
 * Souls are merged in the order given — global first, project last — so a
 * repository's soul.md overrides the machine's, which is the same precedence
 * the rest of the Second Brain uses.
 *
 * Deliberately forgiving: this file is hand-edited, so a malformed line
 * becomes a free-text note rather than an error. The worst outcome of a typo
 * should be that the router reads a sentence it doesn't act on.
 */
export function readRoutingGuidance(
  souls: Array<{ sections: Array<{ slug: string; entries: string[] }> }>,
): SoulRoutingGuidance {
  const slug = ROUTING_SECTION.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const guidance: SoulRoutingGuidance = {
    routerModel: "",
    routes: {},
    notes: [],
  };

  for (const soul of souls) {
    const section = soul.sections.find((s) => s.slug === slug);
    if (!section) continue;

    for (const entry of section.entries) {
      const model = entry.match(
        new RegExp(`^${ROUTER_MODEL_LABEL}\\s*:\\s*(.+)$`, "i"),
      );
      if (model) {
        const value = model[1].trim();
        // "(automatic)" is what the template writes for "you decide".
        guidance.routerModel = /^\(?automatic\)?$/i.test(value) ? "" : value;
        continue;
      }

      const route = entry.match(/^(.+?)\s*(?:→|->)\s*(\S+)\s*$/);
      if (route) {
        const category = route[1].trim().toLowerCase();
        if (category) guidance.routes[category] = route[2].trim();
        continue;
      }

      guidance.notes.push(entry);
    }
  }

  return guidance;
}

export function emptyRoutingGuidance(): SoulRoutingGuidance {
  return { routerModel: "", routes: {}, notes: [] };
}
