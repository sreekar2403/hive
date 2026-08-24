import * as fs from "fs";
import * as path from "path";
import { LAYOUT, ensureStore } from "./paths";
import type { BrainScope, Soul, SoulSection, SoulSuggestion } from "./types";

/**
 * `soul.md` — the standing description of how *this user* likes to work.
 *
 * Two rules from ticket 039-02 shape everything here:
 *
 *   1. It is read on demand by agents, never spliced into a system prompt.
 *      Retrieval decides which sections are relevant; the whole file is not
 *      an ambient tax on every request.
 *   2. The learning agent may only *suggest*. Writes to soul.md come from
 *      the user or from an approved suggestion — never straight from
 *      inference. That is what keeps a wrong guess correctable.
 *
 * Both scopes have their own file: `~/.hive/mem/soul.md` describes you, and
 * `<project>/mem/soul.md` describes how you work *in this repo*. Retrieval
 * reads both, project last.
 */

/** Headings seeded into a new soul.md — the content scope from the ticket. */
const TEMPLATE_SECTIONS = [
  ["Writing style", "How I want prose, commits and docs to read."],
  ["Document preferences", "Markdown conventions, structure, heading style."],
  ["Ideation patterns", "How I like to think a problem through."],
  ["Skill choices", "Which tools and skills I reach for, and which I skip."],
  ["UI preferences", "Layout, density, colour, what I want on screen."],
  ["Harness preferences", "When to pick which CLI, and which model."],
] as const;

export function soulTemplate(scope: BrainScope): string {
  const scopeLine =
    scope === "global"
      ? "Applies to every project on this machine."
      : "Applies to this repository, and overrides the global soul.";

  const body = TEMPLATE_SECTIONS.map(
    ([heading, hint]) => `## ${heading}\n\n<!-- ${hint} -->\n`,
  ).join("\n");

  return `# Soul\n\n${scopeLine}\nAgents read this file on demand — it is not a system prompt.\nEdit it freely; Hive only ever appends entries you have approved.\n\n${body}`;
}

export class SoulStore {
  private readonly scopes: Array<{ scope: BrainScope; root: string }>;

  constructor(scopes: Array<{ scope: BrainScope; root: string }>) {
    this.scopes = scopes;
  }

  /**
   * Reads one scope's soul.md. When the file doesn't exist yet, `raw` is
   * the template and `exists` is false — a caller can show the user what
   * they'd be starting from without anything being written to disk.
   */
  read(scope: BrainScope): Soul {
    const root = this.rootFor(scope);
    const filePath = path.join(root, LAYOUT.soul);
    const exists = fs.existsSync(filePath);
    const raw = exists
      ? fs.readFileSync(filePath, "utf-8")
      : soulTemplate(scope);

    return { raw, sections: parseSoul(raw), path: filePath, exists, scope };
  }

  /** Both scopes, global first — the order retrieval merges them in. */
  readAll(): Soul[] {
    return this.scopes.map(({ scope }) => this.read(scope));
  }

  /** Replaces a scope's soul.md wholesale. This is the "user edits it" path. */
  write(scope: BrainScope, content: string): Soul {
    const root = this.rootFor(scope);
    ensureStore(root);
    fs.writeFileSync(path.join(root, LAYOUT.soul), content, "utf-8");
    return this.read(scope);
  }

  /**
   * Appends one bullet under a heading, creating the heading if needed.
   * Only ever called for a suggestion the user approved, or for an entry
   * the user typed themselves.
   */
  appendEntry(scope: BrainScope, section: string, entry: string): Soul {
    const current = this.read(scope);
    const line = `- ${entry.replace(/^[-*]\s*/, "").trim()}`;
    const target = current.sections.find(
      (s) => s.slug === slugifyHeading(section),
    );

    if (!target) {
      const heading = section.trim();
      const trimmed = current.raw.replace(/\s*$/, "");
      return this.write(scope, `${trimmed}\n\n## ${heading}\n\n${line}\n`);
    }

    // Already there — appending a duplicate would slowly turn the file into
    // a log rather than a description.
    if (target.entries.some((e) => e.toLowerCase() === entry.toLowerCase())) {
      return current;
    }

    const lines = current.raw.split(/\r?\n/);
    const insertAt = endOfSection(lines, target.heading);
    lines.splice(insertAt, 0, line);
    return this.write(scope, lines.join("\n"));
  }

  /* ---------------- suggestions ---------------- */

  /**
   * The approval queue. Kept in the *global* store by default so a pending
   * suggestion doesn't show up as an uncommitted change in the user's repo
   * while they're deciding on it.
   */
  listSuggestions(scope: BrainScope = "global"): SoulSuggestion[] {
    const filePath = this.suggestionsPath(scope);
    try {
      if (!fs.existsSync(filePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return Array.isArray(parsed) ? (parsed as SoulSuggestion[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Queues a suggestion. Deduplicated on (section, entry) against anything
   * still pending *or* already rejected — re-proposing something the user
   * turned down is the fastest way to make them stop reading the queue.
   */
  suggest(
    suggestion: Omit<SoulSuggestion, "id" | "status" | "createdAt" | "resolvedAt">,
    scope: BrainScope = "global",
  ): SoulSuggestion | null {
    const existing = this.listSuggestions(scope);
    const duplicate = existing.find(
      (s) =>
        s.status !== "approved" &&
        s.section === suggestion.section &&
        s.entry.toLowerCase() === suggestion.entry.toLowerCase(),
    );
    if (duplicate) return null;

    // Nor should we suggest something the file already says.
    const soul = this.read(scope);
    const section = soul.sections.find(
      (s) => s.slug === slugifyHeading(suggestion.section),
    );
    if (
      section?.entries.some(
        (e) => e.toLowerCase() === suggestion.entry.toLowerCase(),
      )
    ) {
      return null;
    }

    const record: SoulSuggestion = {
      ...suggestion,
      id: `sug_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      status: "pending",
      createdAt: Date.now(),
      resolvedAt: null,
    };

    this.writeSuggestions(scope, [record, ...existing]);
    return record;
  }

  /** Approving is the only automated path into soul.md. */
  approveSuggestion(id: string, scope: BrainScope = "global"): Soul | null {
    const suggestions = this.listSuggestions(scope);
    const target = suggestions.find((s) => s.id === id);
    if (!target || target.status !== "pending") return null;

    target.status = "approved";
    target.resolvedAt = Date.now();
    this.writeSuggestions(scope, suggestions);
    return this.appendEntry(scope, target.section, target.entry);
  }

  rejectSuggestion(id: string, scope: BrainScope = "global"): boolean {
    const suggestions = this.listSuggestions(scope);
    const target = suggestions.find((s) => s.id === id);
    if (!target || target.status !== "pending") return false;

    target.status = "rejected";
    target.resolvedAt = Date.now();
    this.writeSuggestions(scope, suggestions);
    return true;
  }

  /* ---------------------------------------------------------------- */

  private rootFor(scope: BrainScope): string {
    const root = this.scopes.find((s) => s.scope === scope)?.root;
    if (!root) throw new Error(`Second Brain has no '${scope}' scope`);
    return root;
  }

  private suggestionsPath(scope: BrainScope): string {
    return path.join(this.rootFor(scope), LAYOUT.suggestions);
  }

  private writeSuggestions(scope: BrainScope, list: SoulSuggestion[]): void {
    const root = this.rootFor(scope);
    ensureStore(root);
    // Resolved suggestions are kept as an audit trail, but not forever —
    // the newest 200 is plenty to answer "did I already say no to this?".
    const trimmed = list.slice(0, 200);
    fs.writeFileSync(
      this.suggestionsPath(scope),
      `${JSON.stringify(trimmed, null, 2)}\n`,
      "utf-8",
    );
  }
}

/**
 * Splits a soul.md into its `##` sections. Anything above the first `##`
 * (the title and preamble) is intentionally dropped: it is scaffolding for
 * the human reader, not content an agent should act on.
 */
export function parseSoul(raw: string): SoulSection[] {
  const lines = raw.split(/\r?\n/);
  const sections: SoulSection[] = [];
  let current: { heading: string; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n").trim();
    sections.push({
      heading: current.heading,
      slug: slugifyHeading(current.heading),
      body,
      entries: extractEntries(current.body),
    });
  };

  for (const line of lines) {
    const heading = line.match(/^##\s+(.*\S)\s*$/);
    if (heading) {
      flush();
      current = { heading: heading[1], body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();

  return sections;
}

/** Bullet lines, markers stripped. HTML-comment hints are not entries. */
function extractEntries(lines: string[]): string[] {
  const entries: string[] = [];
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*\S)\s*$/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (!text || text.startsWith("<!--")) continue;
    entries.push(text);
  }
  return entries;
}

export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The index just past a section's last non-blank line, which is where a new
 * bullet belongs — appending at the very end of the section would leave the
 * blank line separating it from the next heading above the new entry.
 */
function endOfSection(lines: string[], heading: string): number {
  const start = lines.findIndex((l) => l.match(/^##\s+(.*\S)\s*$/)?.[1] === heading);
  if (start === -1) return lines.length;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  return insertAt;
}
