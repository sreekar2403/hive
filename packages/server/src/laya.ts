import { execFile } from "child_process";

/** One Laya forward pass over 4–6 typed questions. All scores are 0…1 except complexity/risk (0…2 scale). */
export interface LayaPrediction {
  category: string;
  categoryConfidence: number;
  complexity: number;
  needsStrongModel: number;
  multiFile: number;
  risk: number;
  destructive: number;
}

export interface LayaPredictor {
  predict(query: string): Promise<LayaPrediction | null>;
}

export const LAYA_CATEGORIES = [
  "test",
  "refactor",
  "docs",
  "devops",
  "ui",
  "research",
  "feature",
  "bugfix",
  "other",
] as const;

/** Coarse-to-fine map derived from harnesses/profiles.ts strengths. */
export const CATEGORY_TO_HARNESS: Record<string, string> = {
  test: "opencode",
  refactor: "claude-code",
  docs: "claude-code",
  devops: "opencode",
  ui: "claude-code",
  research: "opencode",
  feature: "opencode",
  bugfix: "codex",
  other: "opencode",
};

export function mapCategoryToHarness(
  category: string,
  available: string[],
  fallback: string,
): string {
  const mapped = CATEGORY_TO_HARNESS[category] ?? fallback;
  if (available.includes(mapped)) return mapped;
  if (available.includes(fallback)) return fallback;
  return available[0] ?? fallback;
}

/** Disabled / missing backend: always falls through. */
export class NullLayaPredictor implements LayaPredictor {
  async predict(): Promise<null> {
    return null;
  }
}

/**
 * Calls an optional Python bridge (`python -m hive_laya_bridge`) that loads
 * `convaiinnovations/laya` locally and prints one JSON object to stdout.
 * Any failure — missing binary, missing weights, timeout, bad JSON —
 * returns null so routing falls through to the LLM/heuristics.
 */
export class SubprocessLayaPredictor implements LayaPredictor {
  constructor(private timeoutMs = 1500) {}

  async predict(query: string): Promise<LayaPrediction | null> {
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          "python",
          ["-m", "hive_laya_bridge"],
          { timeout: this.timeoutMs, maxBuffer: 65536 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
        try {
          child.stdin?.write(JSON.stringify({ task: query.slice(0, 4000) }));
          child.stdin?.end();
        } catch {
          reject(new Error("laya stdin write failed"));
        }
      });
      const line = out.trim().split("\n").pop() ?? "";
      const parsed = JSON.parse(line) as Partial<LayaPrediction>;
      if (typeof parsed?.category !== "string") return null;
      return {
        category: parsed.category,
        categoryConfidence: Number(parsed.categoryConfidence ?? 0),
        complexity: Number(parsed.complexity ?? 0),
        needsStrongModel: Number(parsed.needsStrongModel ?? 0),
        multiFile: Number(parsed.multiFile ?? 0),
        risk: Number(parsed.risk ?? 0),
        destructive: Number(parsed.destructive ?? 0),
      };
    } catch {
      return null;
    }
  }
}
