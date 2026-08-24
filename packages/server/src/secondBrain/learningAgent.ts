import type { SecondBrainConfig } from "../config";
import { KnowledgeGraph, nodeId } from "./graph";
import { RecordStore, slugify } from "./store";
import { SoulStore } from "./soul";
import type {
  BrainRecord,
  BrainScope,
  RoutingHint,
  SoulSuggestion,
  TaskContext,
  TaskOutcome,
} from "./types";

/**
 * The self-learning background agent (ticket 039-03).
 *
 * Two triggers, as the ticket settled on:
 *
 *   - **event-driven** (`observe`): runs inline at the end of every task and
 *     is deliberately cheap — pure bookkeeping, no model call, a few file
 *     writes. It must never be the reason a task feels slow.
 *   - **periodic batch** (`runBatch`): the expensive pass. It re-reads what
 *     has accumulated, looks for patterns across tasks, and queues soul.md
 *     suggestions. It refuses to run while a task is in flight, so it can't
 *     compete with real work for CPU or for the model.
 *
 * Everything it derives is heuristic by default. A model is *optional*: when
 * `learning.model` is configured a `Synthesizer` can propose richer soul
 * entries, but with no model configured the layer still learns — it just
 * learns less. That ordering is on purpose; a memory layer that needs an API
 * key to do anything is a memory layer that is off for half its users.
 */

/**
 * Optional LLM-assisted synthesis. Given the evidence the heuristics found,
 * it may propose soul.md entries the heuristics would not have phrased.
 * Returning `[]` (or throwing) simply means "no suggestions this round".
 */
export interface Synthesizer {
  propose(input: {
    records: BrainRecord[];
    soul: string[];
  }): Promise<Array<{ section: string; entry: string; rationale: string; confidence: number }>>;
}

/** How many observations before a routing record is allowed to advise anyone. */
const ROUTING_ADVICE_FLOOR = 3;

export class LearningAgent {
  private readonly records: RecordStore;
  private readonly graph: KnowledgeGraph;
  private readonly soul: SoulStore;
  private config: SecondBrainConfig;
  private synthesizer: Synthesizer | null;

  /** Tasks currently running, so the batch pass can stand aside. */
  private activeTasks = new Set<string>();
  private lastBatchAt = 0;
  private batchRunning = false;

  constructor(
    records: RecordStore,
    graph: KnowledgeGraph,
    soul: SoulStore,
    config: SecondBrainConfig,
    synthesizer: Synthesizer | null = null,
  ) {
    this.records = records;
    this.graph = graph;
    this.soul = soul;
    this.config = config;
    this.synthesizer = synthesizer;
  }

  setConfig(config: SecondBrainConfig): void {
    this.config = config;
  }

  setSynthesizer(synthesizer: Synthesizer | null): void {
    this.synthesizer = synthesizer;
  }

  /** Called when a task starts, so `runBatch` knows the machine is busy. */
  taskStarted(taskId: string): void {
    this.activeTasks.add(taskId);
  }

  taskFinished(taskId: string): void {
    this.activeTasks.delete(taskId);
  }

  /**
   * The event-driven pass. Records what happened, updates the graph, and
   * returns the records it touched (mostly so tests and the API can show
   * their work).
   *
   * Writes go to the *project* scope: what worked in this repo is evidence
   * about this repo. Cross-project generalisation is the batch pass's job,
   * and it is the only thing that writes global records.
   */
  observe(context: TaskContext, outcome: TaskOutcome): BrainRecord[] {
    if (!this.config.enabled || !this.config.learning.enabled) return [];

    const triggers = this.config.learning.triggers;
    const isFailure = !outcome.success;
    const isCorrection = Boolean(outcome.correction);

    // Routing evidence is collected on every task, pass or fail: a success
    // rate needs the denominator, not just the numerator.
    const touched: BrainRecord[] = [];
    const category = context.category || "general";
    const harness = context.harness || "unknown";

    touched.push(this.recordRouting(category, harness, outcome));

    if (isFailure && triggers.onFailure) {
      const failure = this.recordFailure(category, harness, context, outcome);
      if (failure) touched.push(failure);
    }

    if (outcome.success) {
      const strategy = this.recordStrategy(category, harness, context, outcome);
      if (strategy) touched.push(strategy);
    }

    if (isCorrection && triggers.onCorrection) {
      touched.push(this.recordCorrection(category, context, outcome));
    }

    this.linkGraph(category, harness, outcome, touched);
    return touched;
  }

  /**
   * An explicit "note this" from the user — the highest-trust input the
   * layer takes. Stored as a `user`-sourced rule, pre-approved, so it
   * outranks anything inferred and is never quietly overwritten.
   */
  note(
    text: string,
    options: {
      scope?: BrainScope;
      category?: string | null;
      tags?: string[];
    } = {},
  ): BrainRecord | null {
    if (!this.config.enabled) return null;
    if (!this.config.learning.triggers.onExplicitNote) return null;

    const trimmed = text.trim();
    if (!trimmed) return null;

    const [title, ...rest] = trimmed.split(/\n+/);
    return this.records.put(
      options.scope ?? "global",
      { store: "user", shelf: "rules" },
      {
        id: slugify(title),
        title: title.trim(),
        body: rest.join("\n").trim(),
        category: options.category ?? null,
        tags: options.tags ?? [],
        confidence: 1,
        source: "user",
        approved: true,
      },
    );
  }

  /**
   * The periodic batch. Returns the suggestions it queued (possibly none),
   * or null when it declined to run — the caller can tell "nothing to learn"
   * apart from "not now".
   */
  async runBatch(options: { force?: boolean } = {}): Promise<SoulSuggestion[] | null> {
    if (!this.config.enabled || !this.config.learning.enabled) return null;
    if (!options.force && !this.config.learning.triggers.periodic) return null;
    if (this.batchRunning) return null;

    // Deeper synthesis while agents are working would contend for exactly
    // the resources they need. It can wait; that is what makes it a batch.
    if (!options.force && this.activeTasks.size > 0) return null;

    const since = Date.now() - this.lastBatchAt;
    if (!options.force && since < this.config.learning.batchIntervalMs) return null;

    this.batchRunning = true;
    try {
      const queued: SoulSuggestion[] = [];
      const budget = this.config.learning.maxSuggestionsPerBatch;

      for (const draft of this.deriveSuggestions()) {
        if (queued.length >= budget) break;
        const suggestion = this.soul.suggest(draft);
        if (suggestion) queued.push(suggestion);
      }

      if (this.synthesizer && queued.length < budget) {
        for (const draft of await this.synthesise()) {
          if (queued.length >= budget) break;
          const suggestion = this.soul.suggest({
            section: draft.section,
            entry: draft.entry,
            rationale: draft.rationale,
            confidence: draft.confidence,
            evidence: [],
          });
          if (suggestion) queued.push(suggestion);
        }
      }

      this.lastBatchAt = Date.now();
      return queued;
    } finally {
      this.batchRunning = false;
    }
  }

  /**
   * Learned routing advice for a category, best harness first. Only speaks
   * when it has enough observations to mean something — see
   * `ROUTING_ADVICE_FLOOR` and `routing.minSamples`.
   */
  routingHints(category: string): RoutingHint[] {
    if (!this.config.enabled) return [];

    const floor = Math.max(ROUTING_ADVICE_FLOOR, this.config.routing.minSamples);
    const hints: RoutingHint[] = [];

    for (const record of this.records.list({
      store: "task",
      shelf: "routing",
      category,
    })) {
      const attempts = Number(record.samples ?? 0);
      const successes = Number(
        (record as unknown as { successes?: number }).successes ??
          extractSuccesses(record),
      );
      if (!record.harness || attempts < floor) continue;
      hints.push({
        harness: record.harness,
        successRate: attempts > 0 ? successes / attempts : 0,
        samples: attempts,
        reasoning: `${successes}/${attempts} ${category} tasks succeeded on ${record.harness}`,
      });
    }

    return hints.sort((a, b) => b.successRate - a.successRate);
  }

  /* ------------------------------------------------------------------ */
  /* Heuristics                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * One record per (category, harness). Attempts live in `samples`, and
   * successes are carried in the body as a machine-readable counter — the
   * store's generic shape has nowhere better, and keeping it in the body
   * means it survives a hand-edit as readable text.
   */
  private recordRouting(
    category: string,
    harness: string,
    outcome: TaskOutcome,
  ): BrainRecord {
    const id = slugify(`routing-${category}-${harness}`);
    const previous = this.records.get(id);
    const attempts = (previous?.samples ?? 0) + 1;
    const successes = extractSuccesses(previous) + (outcome.success ? 1 : 0);
    const rate = successes / attempts;

    return this.records.put(
      "project",
      { store: "task", shelf: "routing" },
      {
        id,
        title: `${harness} on ${category} tasks: ${Math.round(rate * 100)}% success`,
        body: `successes=${successes}\nattempts=${attempts}\nlast=${
          outcome.success ? "ok" : "failed"
        }\nmedian_iterations≈${outcome.iterations}`,
        category,
        harness,
        tags: ["routing", category, harness],
        confidence: rate,
        source: "observed",
      },
    );
  }

  /**
   * Failures are keyed by an error *signature* rather than the raw text, so
   * the same class of failure recurring in ten different files converges on
   * one record instead of ten. See `errorSignature`.
   */
  private recordFailure(
    category: string,
    harness: string,
    context: TaskContext,
    outcome: TaskOutcome,
  ): BrainRecord | null {
    const signature = errorSignature(outcome.error ?? "");
    if (!signature) return null;

    const id = slugify(`failure-${category}-${signature}`);
    const previous = this.records.get(id);
    const seen = (previous?.samples ?? 0) + 1;

    return this.records.put(
      "project",
      { store: "task", shelf: "failures" },
      {
        id,
        title: `${category} tasks fail on: ${signature}`,
        body: [
          previous?.body ?? "",
          `- ${new Date().toISOString()} · ${harness} · ${truncate(context.prompt, 140)}`,
        ]
          .filter(Boolean)
          .join("\n")
          // Keep the record readable; the last dozen occurrences is enough
          // to see a pattern without the file growing without bound.
          .split("\n")
          .slice(-12)
          .join("\n"),
        category,
        harness,
        tags: ["failure", category, signature],
        // A failure seen once is a fluke; seen repeatedly it's a pattern.
        confidence: Math.min(0.95, 0.3 + seen * 0.1),
        source: "observed",
      },
    );
  }

  /**
   * Successful approaches, recorded only when the run actually demonstrates
   * something. A task that needed five iterations to limp over the line is
   * not a strategy worth repeating, so it isn't stored as one.
   */
  private recordStrategy(
    category: string,
    harness: string,
    context: TaskContext,
    outcome: TaskOutcome,
  ): BrainRecord | null {
    if (outcome.iterations > 2) return null;

    const id = slugify(`strategy-${category}-${harness}`);
    const firstTry = outcome.iterations === 1;

    return this.records.put(
      "project",
      { store: "task", shelf: "strategies" },
      {
        id,
        title: `${harness} handles ${category} work${firstTry ? " first try" : " within two iterations"}`,
        body: [
          `model=${context.model ?? "default"}`,
          `iterations=${outcome.iterations}`,
          `files_changed=${outcome.filesChanged}`,
          `duration_ms=${outcome.durationMs}`,
        ].join("\n"),
        category,
        harness,
        tags: ["strategy", category, harness],
        confidence: firstTry ? 0.7 : 0.5,
        source: "observed",
      },
    );
  }

  /**
   * A correction is the user telling us we got it wrong. It goes to the
   * *user* store rather than the task store, because what it teaches is a
   * preference, not a technique — and it is worth more than any number of
   * silent successes.
   */
  private recordCorrection(
    category: string,
    context: TaskContext,
    outcome: TaskOutcome,
  ): BrainRecord {
    const correction = (outcome.correction ?? "").trim();
    const id = slugify(`correction-${category}-${correction}`);

    return this.records.put(
      "project",
      { store: "user", shelf: "patterns" },
      {
        id,
        title: `Corrected on ${category} work: ${truncate(correction, 90)}`,
        body: `original_prompt=${truncate(context.prompt, 200)}\ncorrection=${correction}`,
        category,
        harness: context.harness ?? null,
        tags: ["correction", category],
        confidence: 0.75,
        source: "observed",
      },
    );
  }

  /**
   * Wires what we just learned into the graph: the category is the hub, the
   * harness's performance hangs off it, and every record we touched points
   * back at the evidence it came from.
   */
  private linkGraph(
    category: string,
    harness: string,
    outcome: TaskOutcome,
    touched: BrainRecord[],
  ): void {
    const categoryNode = nodeId("category", category);
    const perfNode = nodeId("harness_perf", `${harness}-${category}`);

    this.graph.upsertNode("project", {
      id: categoryNode,
      type: "category",
      label: category,
      properties: { category },
    });

    this.graph.upsertNode("project", {
      id: perfNode,
      type: "harness_perf",
      label: `${harness} · ${category}`,
      properties: { harness, category },
    });

    // Strength *is* the success signal here: a harness that keeps failing a
    // category gets a weak edge, which is what makes traversal rank it low.
    this.graph.upsertEdge("project", {
      type: "correlates",
      from: perfNode,
      to: categoryNode,
      strength: outcome.success ? 0.85 : 0.15,
      properties: { samples: touched[0]?.samples ?? 1 },
    });

    for (const record of touched) {
      const type = record.store === "user" ? "user_pref" : "task_pattern";
      const recordNode = nodeId(type, record.id);
      this.graph.upsertNode("project", {
        id: recordNode,
        type,
        label: record.title,
        properties: {
          recordId: record.id,
          shelf: record.shelf,
          confidence: record.confidence,
        },
      });
      this.graph.upsertEdge("project", {
        type: record.store === "user" ? "influences" : "derived_from",
        from: recordNode,
        to: categoryNode,
        strength: record.confidence,
      });
    }
  }

  /**
   * Turns accumulated records into soul.md drafts. Only patterns with real
   * evidence behind them make it this far — the bar is deliberately high,
   * because every suggestion costs the user a decision.
   */
  private deriveSuggestions(): Array<
    Omit<SoulSuggestion, "id" | "status" | "createdAt" | "resolvedAt">
  > {
    const drafts: Array<
      Omit<SoulSuggestion, "id" | "status" | "createdAt" | "resolvedAt">
    > = [];

    // 1. Harness preferences, where one harness clearly beats the others.
    const byCategory = new Map<string, BrainRecord[]>();
    for (const record of this.records.list({ store: "task", shelf: "routing" })) {
      if (!record.category) continue;
      const list = byCategory.get(record.category) ?? [];
      list.push(record);
      byCategory.set(record.category, list);
    }

    for (const [category, records] of byCategory) {
      const ranked = records
        .filter((r) => r.samples >= this.config.routing.minSamples && r.harness)
        .sort((a, b) => b.confidence - a.confidence);
      if (ranked.length < 2) continue;

      const [best, runnerUp] = ranked;
      if (best.confidence - runnerUp.confidence < this.config.routing.minMargin) {
        continue;
      }

      drafts.push({
        section: "Harness preferences",
        entry: `Prefer ${best.harness} for ${category} tasks (${Math.round(
          best.confidence * 100,
        )}% success over ${best.samples} runs, vs ${Math.round(
          runnerUp.confidence * 100,
        )}% for ${runnerUp.harness}).`,
        rationale: `Observed across ${best.samples + runnerUp.samples} ${category} tasks.`,
        confidence: best.confidence,
        evidence: [best.id, runnerUp.id],
      });
    }

    // 2. Recurring failures worth a standing note.
    for (const failure of this.records.list({
      store: "task",
      shelf: "failures",
      minConfidence: 0.6,
    })) {
      if (failure.samples < this.config.routing.minSamples) continue;
      drafts.push({
        section: "Skill choices",
        entry: `Check for "${failure.tags.at(-1) ?? "this failure"}" before starting ${
          failure.category ?? "these"
        } tasks — it has bitten ${failure.samples} runs.`,
        rationale: failure.title,
        confidence: failure.confidence,
        evidence: [failure.id],
      });
    }

    // 3. Corrections that keep recurring are a preference in disguise.
    for (const correction of this.records.list({
      store: "user",
      shelf: "patterns",
      tags: ["correction"],
      minConfidence: this.config.learning.minConfidence,
    })) {
      if (correction.samples < 2) continue;
      drafts.push({
        section: "Writing style",
        entry: correction.title.replace(/^Corrected on [^:]+: /, ""),
        rationale: `You have corrected this ${correction.samples} times.`,
        confidence: correction.confidence,
        evidence: [correction.id],
      });
    }

    return drafts.sort((a, b) => b.confidence - a.confidence);
  }

  /** LLM-assisted pass. Never allowed to break the batch if it misbehaves. */
  private async synthesise(): Promise<
    Array<{ section: string; entry: string; rationale: string; confidence: number }>
  > {
    if (!this.synthesizer) return [];
    try {
      const records = this.records.list({ limit: 40 });
      const soul = this.soul
        .readAll()
        .flatMap((s) => s.sections.flatMap((section) => section.entries));
      const proposals = await this.synthesizer.propose({ records, soul });
      return proposals.filter(
        (p) =>
          p &&
          typeof p.entry === "string" &&
          p.entry.trim().length > 0 &&
          p.confidence >= this.config.learning.minConfidence,
      );
    } catch (err) {
      console.warn(
        `[second-brain] synthesis skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }
}

/**
 * Reduces an error to the part that identifies its *kind*: paths, line and
 * column numbers, hex addresses, hashes and bare integers are all noise
 * that would otherwise make every occurrence look unique.
 */
export function errorSignature(error: string): string | null {
  const firstLine = error
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;

  return (
    firstLine
      .toLowerCase()
      // Windows and POSIX paths alike.
      .replace(/[a-z]:\\[^\s:]+/g, "<path>")
      .replace(/(?:\.{0,2}\/)[^\s:]+/g, "<path>")
      .replace(/0x[0-9a-f]+/g, "<addr>")
      .replace(/\b[0-9a-f]{7,}\b/g, "<hash>")
      .replace(/\b\d+\b/g, "<n>")
      .replace(/["'`].*?["'`]/g, "<str>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || null
  );
}

/** Successes are carried as `successes=<n>` in a routing record's body. */
function extractSuccesses(record: BrainRecord | null): number {
  if (!record?.body) return 0;
  const match = record.body.match(/successes=(\d+)/);
  return match ? Number(match[1]) : 0;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
