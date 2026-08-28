import * as fs from "fs";
import * as path from "path";
import { ensureStore, storeExists } from "./paths";
import type {
  BrainRecord,
  BrainRecordInput,
  BrainScope,
  BrainShelf,
  BrainStore,
} from "./types";

/**
 * The file-based reader/writer behind `mem/user/` and `mem/task/`.
 *
 * One record is one JSON file, named by its id, on a shelf that is a plain
 * directory. That is a deliberate choice over a database: an agent can read
 * the store with the file tools it already has, a human can edit a record in
 * an editor, and the whole thing diffs cleanly when a project commits its
 * `mem/` directory.
 *
 * Reads merge the global and project scopes; writes always name one. When
 * the same record id exists in both, project wins — a repo can contradict a
 * machine-wide habit without deleting it.
 */

/** Record ids become filenames, so they get the same treatment session ids do. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function isSafeId(id: string): boolean {
  return (
    typeof id === "string" && SAFE_ID.test(id) && id !== "." && id !== ".."
  );
}

/** Turns a title into a stable, filesystem-safe id. */
export function slugify(input: string, fallback = "entry"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

export interface ShelfRef {
  store: BrainStore;
  shelf: BrainShelf;
}

/** Filters applied to a read. Everything is optional; omitted means "any". */
export interface RecordQuery extends Partial<ShelfRef> {
  category?: string | null;
  harness?: string | null;
  /** Matched against tags, title and body, case-insensitively. */
  tags?: string[];
  /** Free text matched against title and body. */
  text?: string;
  /** Drop anything below this confidence. */
  minConfidence?: number;
  /** Only records the user has signed off on. */
  approvedOnly?: boolean;
  limit?: number;
}

export class RecordStore {
  /** Read order: least specific first, so later scopes overwrite earlier ones. */
  private readonly scopes: Array<{ scope: BrainScope; root: string }>;

  constructor(scopes: Array<{ scope: BrainScope; root: string }>) {
    this.scopes = scopes;
  }

  /** The on-disk root for one scope, or null when this store has no such scope. */
  rootFor(scope: BrainScope): string | null {
    return this.scopes.find((s) => s.scope === scope)?.root ?? null;
  }

  /**
   * Every record matching `query`, merged across scopes and ranked by
   * relevance to the query rather than by mtime — a caller asking for
   * "the 5 lessons that matter here" should get the 5 that matter.
   */
  list(query: RecordQuery = {}): BrainRecord[] {
    const merged = new Map<string, BrainRecord>();

    for (const { root } of this.scopes) {
      for (const record of this.readScope(root, query)) {
        merged.set(record.id, record);
      }
    }

    const matches = Array.from(merged.values()).filter((r) =>
      this.matches(r, query),
    );

    matches.sort((a, b) => {
      const byScore = this.score(b, query) - this.score(a, query);
      if (byScore !== 0) return byScore;
      return b.updatedAt - a.updatedAt;
    });

    return typeof query.limit === "number"
      ? matches.slice(0, Math.max(0, query.limit))
      : matches;
  }

  /** One record by id, project scope winning, or null when absent. */
  get(id: string): BrainRecord | null {
    if (!isSafeId(id)) return null;
    let found: BrainRecord | null = null;
    for (const { root } of this.scopes) {
      for (const record of this.readScope(root, {})) {
        if (record.id === id) found = record;
      }
    }
    return found;
  }

  /**
   * Writes a record, creating the store tree on demand. An existing record
   * with the same id is *merged into*, not replaced: `samples` accumulates
   * and `confidence` moves toward the new value rather than jumping to it,
   * so one lucky observation can't mint a high-confidence fact.
   */
  put(scope: BrainScope, ref: ShelfRef, input: BrainRecordInput): BrainRecord {
    const root = this.rootFor(scope);
    if (!root) throw new Error(`Second Brain has no '${scope}' scope`);

    const id = input.id && isSafeId(input.id) ? input.id : slugify(input.title);
    const now = Date.now();
    const existing = this.readFile(this.filePath(root, ref, id));

    const record: BrainRecord = {
      id,
      store: ref.store,
      shelf: ref.shelf,
      title: input.title,
      body: input.body ?? existing?.body ?? "",
      tags: normaliseTags(input.tags ?? existing?.tags ?? []),
      category: input.category ?? existing?.category ?? null,
      harness: input.harness ?? existing?.harness ?? null,
      confidence: nextConfidence(existing, input.confidence),
      samples: (existing?.samples ?? 0) + (input.samples ?? 1),
      source: input.source ?? existing?.source ?? "observed",
      // A record the user has already approved stays approved through
      // later observations; only an explicit `approved: false` clears it.
      approved: input.approved ?? existing?.approved ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    ensureStore(root);
    fs.writeFileSync(
      this.filePath(root, ref, id),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf-8",
    );
    return record;
  }

  /** Removes a record from one scope. Returns whether anything was there. */
  remove(scope: BrainScope, ref: ShelfRef, id: string): boolean {
    const root = this.rootFor(scope);
    if (!root || !isSafeId(id)) return false;
    const filePath = this.filePath(root, ref, id);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  /** Counts per shelf, for the Memory screen's summary. */
  counts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of this.list()) {
      const key = `${record.store}/${record.shelf}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  /* ---------------------------------------------------------------- */

  private filePath(root: string, ref: ShelfRef, id: string): string {
    return path.join(root, ref.store, ref.shelf, `${id}.json`);
  }

  /** Reads whole shelves off disk. Missing directories are simply empty. */
  private readScope(root: string, query: RecordQuery): BrainRecord[] {
    if (!storeExists(root)) return [];

    const stores: BrainStore[] = query.store ? [query.store] : ["user", "task"];
    const out: BrainRecord[] = [];

    for (const store of stores) {
      const storeDir = path.join(root, store);
      if (!fs.existsSync(storeDir)) continue;

      const shelves = query.shelf
        ? [query.shelf]
        : (fs
            .readdirSync(storeDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name) as BrainShelf[]);

      for (const shelf of shelves) {
        const shelfDir = path.join(storeDir, shelf);
        if (!fs.existsSync(shelfDir)) continue;
        for (const file of fs.readdirSync(shelfDir)) {
          if (!file.endsWith(".json")) continue;
          const record = this.readFile(path.join(shelfDir, file));
          if (record) out.push(record);
        }
      }
    }

    return out;
  }

  /** A corrupt or hand-mangled record is skipped, never fatal. */
  private readFile(filePath: string): BrainRecord | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.id !== "string" || typeof parsed.title !== "string") {
        return null;
      }
      return {
        ...parsed,
        tags: normaliseTags(parsed.tags ?? []),
        confidence: clamp01(Number(parsed.confidence ?? 0.5)),
        samples: Number(parsed.samples ?? 1),
        approved: Boolean(parsed.approved),
      } as BrainRecord;
    } catch {
      return null;
    }
  }

  private matches(record: BrainRecord, query: RecordQuery): boolean {
    if (query.store && record.store !== query.store) return false;
    if (query.shelf && record.shelf !== query.shelf) return false;
    if (query.approvedOnly && !record.approved) return false;
    if (
      typeof query.minConfidence === "number" &&
      record.confidence < query.minConfidence
    ) {
      return false;
    }
    // A null category on the record means "applies everywhere", so it stays
    // in the running for any category the caller asks about.
    if (
      query.category &&
      record.category &&
      record.category !== query.category
    ) {
      return false;
    }
    if (query.harness && record.harness && record.harness !== query.harness) {
      return false;
    }
    if (
      query.text &&
      !this.haystack(record).includes(query.text.toLowerCase())
    ) {
      return false;
    }
    return true;
  }

  /**
   * How well a record answers the query. Exact category and harness matches
   * count for more than a tag brush, and confidence breaks ties — a hunch
   * and a well-evidenced fact should not rank the same.
   */
  private score(record: BrainRecord, query: RecordQuery): number {
    let score = record.confidence;

    if (query.category && record.category === query.category) score += 1;
    if (query.harness && record.harness === query.harness) score += 0.5;

    if (query.tags?.length) {
      const haystack = this.haystack(record);
      for (const tag of query.tags) {
        if (!tag) continue;
        if (record.tags.includes(tag.toLowerCase())) score += 0.4;
        else if (haystack.includes(tag.toLowerCase())) score += 0.15;
      }
    }

    // Corroboration is worth something, but with diminishing returns —
    // otherwise a single much-observed record buries everything else.
    score += Math.min(0.5, Math.log10(1 + record.samples) / 2);

    // Records the user wrote or approved outrank anything inferred.
    if (record.source === "user") score += 0.6;
    if (record.approved) score += 0.3;

    return score;
  }

  private haystack(record: BrainRecord): string {
    return `${record.title} ${record.body} ${record.tags.join(" ")}`.toLowerCase();
  }
}

function normaliseTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const clean = tag.trim().toLowerCase();
    if (clean) seen.add(clean);
  }
  return Array.from(seen);
}

/**
 * Confidence moves a third of the way toward each new observation. Slow
 * enough that noise doesn't swing it, fast enough that a genuinely changed
 * habit is reflected within a handful of tasks.
 */
function nextConfidence(
  existing: BrainRecord | null,
  incoming: number | undefined,
): number {
  if (typeof incoming !== "number" || Number.isNaN(incoming)) {
    return existing ? clamp01(existing.confidence) : 0.5;
  }
  if (!existing) return clamp01(incoming);
  return clamp01(existing.confidence + (incoming - existing.confidence) / 3);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
