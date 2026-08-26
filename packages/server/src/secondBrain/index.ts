import type { Config, SecondBrainConfig } from "../config";
import { categorize, keywords } from "./categorize";
import { KnowledgeGraph, nodeId } from "./graph";
import { LearningAgent, type Synthesizer } from "./learningAgent";
import { resolveBrainConfig, storeRoots } from "./paths";
import { RecordStore } from "./store";
import { SoulStore } from "./soul";
import type {
  BrainRecord,
  BrainScope,
  Briefing,
  GraphHit,
  RoutingHint,
  Soul,
  SoulSuggestion,
  TaskContext,
  TaskOutcome,
} from "./types";

export * from "./types";
export { categorize, keywords } from "./categorize";
export { errorSignature } from "./learningAgent";
export { parseSoul, soulTemplate } from "./soul";
export { nodeId } from "./graph";
export { resolveBrainConfig, globalStoreRoot, projectStoreRoot } from "./paths";

/**
 * The Second Brain's public surface — the agent feedback API from ticket
 * 039-05, which settled on **explicit calls** rather than silent injection.
 *
 * An agent's side of the contract is two calls:
 *
 *   const briefing = brain.getBriefing(context);   // before running
 *   brain.recordFeedback(context, outcome);        // after
 *
 * Everything else (`getPreferences`, `getLessons`, `getSoul`,
 * `getGraphInsights`) exists for callers that want one slice rather than
 * the assembled briefing.
 *
 * Retrieval is *scoped*: a caller gets the handful of records relevant to
 * the task in front of it, never a store dump. With an empty store every
 * method returns empty — a fresh install behaves exactly like one without
 * the layer, which is what makes it safe to have on by default.
 */
export class SecondBrain {
  private config: Config;
  private brainConfig: SecondBrainConfig;
  private readonly projectPath: string | null;

  readonly records: RecordStore;
  readonly graph: KnowledgeGraph;
  readonly soul: SoulStore;
  readonly learning: LearningAgent;

  constructor(
    config: Config,
    projectPath: string | null = null,
    synthesizer: Synthesizer | null = null,
  ) {
    this.config = config;
    this.projectPath = projectPath;
    this.brainConfig = resolveBrainConfig(config, projectPath);

    const scopes = storeRoots(projectPath, this.brainConfig);
    this.records = new RecordStore(scopes);
    this.graph = new KnowledgeGraph(scopes);
    this.soul = new SoulStore(scopes);
    this.learning = new LearningAgent(
      this.records,
      this.graph,
      this.soul,
      this.brainConfig,
      synthesizer,
    );
  }

  /** True when the layer is switched on for this project. */
  get enabled(): boolean {
    return this.brainConfig.enabled;
  }

  /** The effective config after `mem/config.json` overrides. */
  get settings(): SecondBrainConfig {
    return this.brainConfig;
  }

  /**
   * Re-reads config. `hive.config.json` is a live singleton the Settings
   * screen mutates in place, so anything holding a brain needs a way to
   * pick up a change without a restart.
   */
  reload(): void {
    this.brainConfig = resolveBrainConfig(this.config, this.projectPath);
    this.learning.setConfig(this.brainConfig);
  }

  /** Where the two stores live — shown in the UI so the user can go look. */
  roots(): Array<{ scope: BrainScope; root: string }> {
    return storeRoots(this.projectPath, this.brainConfig);
  }

  /* ------------------------------------------------------------------ */
  /* Retrieval                                                           */
  /* ------------------------------------------------------------------ */

  /** User preferences relevant to this task. */
  getPreferences(context: TaskContext): BrainRecord[] {
    if (!this.enabled) return [];
    const category = context.category ?? this.categorize(context.prompt);
    return this.records.list({
      store: "user",
      category,
      tags: keywords(context.prompt),
      minConfidence: this.brainConfig.learning.minConfidence,
      limit: this.brainConfig.retrieval.maxPreferences,
    });
  }

  /** Task strategies and failure patterns relevant to this task. */
  getLessons(context: TaskContext): BrainRecord[] {
    if (!this.enabled) return [];
    const category = context.category ?? this.categorize(context.prompt);
    return this.records
      .list({
        store: "task",
        category,
        harness: context.harness ?? null,
        tags: keywords(context.prompt),
        minConfidence: this.brainConfig.learning.minConfidence,
        limit: this.brainConfig.retrieval.maxLessons * 3,
      })
      // Routing records are bookkeeping for the router, not advice an agent
      // can act on — they'd only take up room in the briefing.
      .filter((r) => r.shelf !== "routing")
      .slice(0, this.brainConfig.retrieval.maxLessons);
  }

  /** One scope's soul.md, or both merged when no scope is named. */
  getSoul(scope?: BrainScope): Soul | Soul[] {
    return scope ? this.soul.read(scope) : this.soul.readAll();
  }

  /**
   * Cross-domain insights for a free-text query. The seed is resolved by
   * label first, so a caller can ask about "refactor" without knowing that
   * the node is really `category:refactor`.
   */
  getGraphInsights(query: string, limit = 8): GraphHit[] {
    if (!this.enabled) return [];

    const direct = this.graph
      .query(nodeId("category", query), { depth: 2, limit })
      .filter((h) => h.node.type !== "category");
    if (direct.length > 0) return direct;

    const [seed] = this.graph.search(query, 1);
    if (!seed) return [];
    return this.graph.query(seed.id, { depth: 2, limit });
  }

  /**
   * The assembled briefing an agent injects ahead of its prompt. Capped at
   * `retrieval.maxBriefingChars` — memory that crowds out the actual
   * request has stopped helping.
   */
  getBriefing(context: TaskContext): Briefing {
    const empty: Briefing = {
      preferences: [],
      lessons: [],
      insights: [],
      soul: [],
      text: "",
    };
    if (!this.enabled) return empty;

    const category = context.category ?? this.categorize(context.prompt);
    const preferences = this.getPreferences({ ...context, category });
    const lessons = this.getLessons({ ...context, category });
    const insights = this.getGraphInsights(category, 4);
    const soul = this.relevantSoulEntries(context.prompt, category);

    const text = renderBriefing(
      { preferences, lessons, insights, soul, text: "" },
      this.brainConfig.retrieval.maxBriefingChars,
    );

    return { preferences, lessons, insights, soul, text };
  }

  /**
   * Soul entries worth showing for this task. The whole file is *not* the
   * answer — ticket 039-02 is explicit that soul.md is read on demand, so
   * this picks the sections that plausibly bear on the work plus anything
   * whose wording overlaps the prompt.
   */
  private relevantSoulEntries(prompt: string, category: string): string[] {
    const terms = new Set([...keywords(prompt), category]);
    const always = new Set(["writing-style", "document-preferences"]);
    const out: string[] = [];

    for (const soul of this.soul.readAll()) {
      for (const section of soul.sections) {
        const sectionMatches =
          always.has(section.slug) ||
          Array.from(terms).some(
            (t) => section.slug.includes(t) || section.heading.toLowerCase().includes(t),
          );

        for (const entry of section.entries) {
          const entryMatches = Array.from(terms).some((t) =>
            entry.toLowerCase().includes(t),
          );
          if (sectionMatches || entryMatches) {
            out.push(`${section.heading}: ${entry}`);
          }
        }
      }
    }

    // Later scopes (project) are appended after global, so a duplicate line
    // keeps its first, global position — the text is identical either way.
    return Array.from(new Set(out)).slice(
      0,
      this.brainConfig.retrieval.maxPreferences,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Writing                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Records how a task went. Cheap and synchronous — see LearningAgent's
   * event-driven pass. Safe to call unconditionally; it no-ops when the
   * layer is off.
   */
  recordFeedback(context: TaskContext, outcome: TaskOutcome): BrainRecord[] {
    if (!this.enabled) return [];
    const category = context.category ?? this.categorize(context.prompt);
    return this.learning.observe({ ...context, category }, outcome);
  }

  /** An explicit "remember this" from the user. */
  note(
    text: string,
    options: { scope?: BrainScope; category?: string | null; tags?: string[] } = {},
  ): BrainRecord | null {
    return this.learning.note(text, options);
  }

  /** Learned routing advice for a category — advisory input to the Router. */
  getRoutingHints(promptOrCategory: string): RoutingHint[] {
    if (!this.enabled || !this.brainConfig.routing.augment) return [];
    const category = this.categorize(promptOrCategory);
    return this.learning.routingHints(
      category === "general" ? promptOrCategory : category,
    );
  }

  /** Runs the periodic batch. Returns null when it declined to run. */
  runLearningBatch(force = false): Promise<SoulSuggestion[] | null> {
    return this.learning.runBatch({ force });
  }

  /** Classifies with the live routing rules, so brain and router agree. */
  categorize(prompt: string): string {
    return categorize(prompt, this.config.routing?.rules ?? []);
  }

  /** Store sizes, for the Memory screen's Second Brain panel. */
  stats(): {
    enabled: boolean;
    records: Record<string, number>;
    graph: { nodes: number; edges: number };
    pendingSuggestions: number;
    roots: Array<{ scope: BrainScope; root: string }>;
  } {
    return {
      enabled: this.enabled,
      records: this.records.counts(),
      graph: this.graph.stats(),
      pendingSuggestions: this.soul
        .listSuggestions()
        .filter((s) => s.status === "pending").length,
      roots: this.roots(),
    };
  }
}

/**
 * Renders a briefing as a prompt preamble. Framed as context the agent may
 * use rather than instructions it must obey: these are inferences, and an
 * inference stated as a command is how a wrong guess becomes a wrong action.
 */
export function renderBriefing(briefing: Briefing, maxChars: number): string {
  const blocks: string[] = [];

  if (briefing.soul.length) {
    blocks.push(
      `Known preferences (from soul.md):\n${briefing.soul
        .map((s) => `- ${s}`)
        .join("\n")}`,
    );
  }

  if (briefing.preferences.length) {
    blocks.push(
      `Learned about how this user works:\n${briefing.preferences
        .map((p) => `- ${p.title}`)
        .join("\n")}`,
    );
  }

  if (briefing.lessons.length) {
    blocks.push(
      `Learned from earlier tasks like this one:\n${briefing.lessons
        .map((l) => `- ${l.title}${l.body ? `\n  ${firstLine(l.body)}` : ""}`)
        .join("\n")}`,
    );
  }

  if (briefing.insights.length) {
    blocks.push(
      `Related patterns:\n${briefing.insights
        .map((i) => `- ${i.node.label}`)
        .join("\n")}`,
    );
  }

  if (blocks.length === 0) return "";

  const body = blocks.join("\n\n");
  // The briefing leads the prompt, and the prompt reaches each CLI as a
  // positional argument: a leading "---" is read as an unknown option and
  // the run dies before it starts. Fence the block with "===" instead.
  const header =
    "=== Context from Hive's memory of your past work ===\n" +
    "These are observations, not instructions. Follow them where they help and ignore them where they don't.\n";
  const footer = "\n=== End of memory context ===\n";

  const budget = Math.max(0, maxChars - header.length - footer.length);
  const trimmed =
    body.length <= budget ? body : `${body.slice(0, Math.max(0, budget - 1))}…`;

  return `${header}\n${trimmed}\n${footer}`;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}
