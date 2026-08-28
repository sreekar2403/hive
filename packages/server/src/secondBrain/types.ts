/**
 * The vocabulary of the Second Brain (tickets 039-01 … 039-06).
 *
 * Two file-based stores plus one graph, all under a `mem/` directory:
 *
 *   mem/user/   what we've learned about the person driving Hive
 *   mem/task/   what we've learned about the work itself
 *   mem/graph/  the cross-domain links between the two
 *
 * Everything here is plain JSON on disk and readable by a human without
 * tooling — that is the point of the layer, not an implementation detail.
 * A record is never silently authoritative: `confidence` and `samples`
 * record how much evidence stands behind it, and consumers filter on both.
 */

/** Which of the two stores a record belongs to, and its shelf within it. */
export type UserShelf = "preferences" | "patterns" | "rules";
export type TaskShelf = "failures" | "strategies" | "routing";

export type BrainStore = "user" | "task";
export type BrainShelf = UserShelf | TaskShelf;

/** Where a record came from, which is also how much it deserves to be trusted. */
export type BrainSource =
  | "user" // stated outright by the person; never overwritten by learning
  | "observed" // derived from what actually happened during a task
  | "agent"; // synthesised by the learning agent from several observations

/**
 * One learned fact. Deliberately flat and self-describing: an agent that
 * reads `mem/` with nothing but `cat` should still understand it.
 */
export interface BrainRecord {
  id: string;
  store: BrainStore;
  shelf: BrainShelf;
  /** One line, human-readable — this is what gets shown to an agent. */
  title: string;
  /** Optional detail: the evidence, the fix, the counter-example. */
  body: string;
  /** Free-form labels used for retrieval, lowercased. */
  tags: string[];
  /** Task category this applies to (`test`, `refactor`, …), or null for "any". */
  category: string | null;
  /** Harness this is about, or null when harness-independent. */
  harness: string | null;
  /** 0…1. Rises as corroborating observations arrive, falls on contradiction. */
  confidence: number;
  /** How many observations stand behind this record. */
  samples: number;
  source: BrainSource;
  /**
   * Whether the user has signed off. Records the agent invents start
   * unapproved; nothing unapproved is ever written into soul.md.
   */
  approved: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A record as supplied by a caller — the store fills in the bookkeeping. */
export type BrainRecordInput = Partial<
  Omit<BrainRecord, "store" | "shelf" | "title">
> &
  Pick<BrainRecord, "title">;

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

export type GraphNodeType =
  "user_pref" | "task_pattern" | "harness_perf" | "soul_entry" | "category";

export type GraphEdgeType = "influences" | "correlates" | "derived_from";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  /** Free-form, per node type — see the ticket's schema table. */
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  type: GraphEdgeType;
  from: string;
  to: string;
  /** 0…1. Traversal ranks by the product of the strengths along a path. */
  strength: number;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** One hop-annotated hit from a graph traversal, ranked by path strength. */
export interface GraphHit {
  node: GraphNode;
  /** Hops from the seed. 0 is the seed itself. */
  depth: number;
  /** Product of edge strengths along the path that found it. */
  score: number;
  /** Node ids from seed to this node, inclusive. */
  path: string[];
}

/* ------------------------------------------------------------------ */
/* Soul                                                                */
/* ------------------------------------------------------------------ */

/**
 * `soul.md` is read by agents on demand — it is explicitly *not* injected
 * into a system prompt (ticket 039-02). It is markdown so a human can edit
 * it directly; the parse below is a convenience, never the source of truth.
 */
export interface SoulSection {
  /** The `##` heading, verbatim. */
  heading: string;
  /** Lowercased, hyphenated heading — used to address a section by id. */
  slug: string;
  /** The lines under the heading, trimmed. */
  body: string;
  /** Bullet lines under the heading, with their markers stripped. */
  entries: string[];
}

export interface Soul {
  /** The file exactly as it sits on disk. */
  raw: string;
  sections: SoulSection[];
  /** Absolute path, so callers can tell the user where to edit it. */
  path: string;
  /** False when no soul.md exists yet; `raw` is then the seeded template. */
  exists: boolean;
  scope: BrainScope;
}

/**
 * A change the learning agent wants to make to soul.md, waiting on the
 * user. Ticket 039-02 settled on option C — suggest, don't apply — so this
 * queue is the only path from learning to soul.md.
 */
export interface SoulSuggestion {
  id: string;
  /** Section slug this belongs under; created if it doesn't exist. */
  section: string;
  /** The line to add, in the user's own bullet style. */
  entry: string;
  /** Why the agent believes this — shown next to the approve button. */
  rationale: string;
  confidence: number;
  /** Record ids this was derived from, for auditing. */
  evidence: string[];
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  resolvedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Scopes                                                              */
/* ------------------------------------------------------------------ */

/**
 * `global` is machine-wide (`~/.hive/mem`); `project` lives in the repo and
 * can be committed. Reads merge both with project winning; writes must name
 * one explicitly, so nothing lands in the wrong place by default.
 */
export type BrainScope = "global" | "project";

/* ------------------------------------------------------------------ */
/* Observations and retrieval                                          */
/* ------------------------------------------------------------------ */

/** What an agent tells the brain about the task it is about to run. */
export interface TaskContext {
  taskId: string;
  prompt: string;
  /** Router's task type when known (`test`, `refactor`, …). */
  category?: string | null;
  harness?: string | null;
  model?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
}

/** What an agent tells the brain about how that task went. */
export interface TaskOutcome {
  success: boolean;
  /** How many loop iterations it took. 1 means first-try. */
  iterations: number;
  durationMs: number;
  filesChanged: number;
  /** The failure text, when it failed — this is what failure patterns key on. */
  error?: string | null;
  /**
   * Set when the user visibly corrected the agent (re-prompted, rejected,
   * edited the result). The strongest learning signal there is.
   */
  correction?: string | null;
}

/**
 * The filtered slice of the brain handed to one task. Scope control from
 * ticket 039-05: relevant records only, never a full store dump.
 */
export interface Briefing {
  preferences: BrainRecord[];
  lessons: BrainRecord[];
  insights: GraphHit[];
  /** Soul entries judged relevant to this task, already flattened to lines. */
  soul: string[];
  /** The whole thing rendered as a prompt preamble, or "" when empty. */
  text: string;
}

/** Learned routing advice. Advisory by construction — see router.ts. */
export interface RoutingHint {
  harness: string;
  /** 0…1 observed success rate for this harness in this category. */
  successRate: number;
  samples: number;
  reasoning: string;
}
