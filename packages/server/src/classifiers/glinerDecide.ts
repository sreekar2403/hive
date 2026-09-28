import { execFile } from "child_process";
import { HiveClassifier, ClassifierPrediction, ClassifierHeads } from "./types";

/**
 * GLiNER2.5-Decide bridge (python -m hive_gliner_bridge).
 *
 * stdin: {"task": "...", "schema": {...}}
 * stdout: one JSON line with multi-head output, e.g.:
 *   {"category":"test","urgency":"high","finished":"yes","policy":"allow","severity":"info","slopScore":0.3}
 *   or with per-head label arrays: {"category":"test","urgency":["high"],"finished":["yes"],"policy":["allow"],"severity":["info"],"slopScore":[0.3]}
 *
 * Any failure — missing binary, no weights, timeout, bad JSON, >512 tokens —
 * returns null so routing falls through safely.
 */
export class GlinerDecidePredictor implements HiveClassifier {
  readonly id = "gliner-decide";
  private timeoutMs: number;

  constructor(timeoutMs = 1500) {
    this.timeoutMs = timeoutMs;
  }

  async predict(task: string): Promise<ClassifierPrediction | null> {
    try {
      const truncated = task.slice(0, 4000);
      const out = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          "python",
          ["-m", "hive_gliner_bridge"],
          { timeout: this.timeoutMs, maxBuffer: 65536 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
        try {
          child.stdin?.write(JSON.stringify({ task: truncated, schema: this.buildSchema() }));
          child.stdin?.end();
        } catch {
          reject(new Error("gliner-decide stdin write failed"));
        }
      });
      const line = out.trim().split("\n").pop() ?? "";
      if (!line) return null;
      const parsed = JSON.parse(line);
      if (this.isValidPrediction(parsed)) {
        return this.mapToClassifierPrediction(parsed);
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Build the JSON schema passed to the GLiNER bridge. */
  private buildSchema(): any {
    // Heads that GLiNER2.5-Decide supports:
    // - category: single label string
    // - urgency: single label string (low|normal|high|critical)
    // - finished: single label "yes"|"no"
    // - policy: single label string (allow|personal_data|scam|spam|...)
    // - severity: single label string (info|low|medium|high|critical)
    // - slopScore: number 0..1 ordinal mapped from 0..10 label
    return {
      category: ["test", "refactor", "docs", "devops", "ui", "research", "feature", "bugfix", "other"],
      urgency: ["low", "normal", "high", "critical"],
      finished: ["yes", "no"],
      policy: ["allow", "personal_data", "scam", "spam", "block"],
      severity: ["info", "low", "medium", "high", "critical"],
      slopScore: 0.0,
    };
  }

  /** Validate the minimum: a category string. Other heads are optional. */
  private isValidPrediction(parsed: any): boolean {
    return typeof parsed?.category === "string" && parsed.category.length > 0;
  }

  /** Map the bridge output to a Hive ClassifierPrediction. */
  private mapToClassifierPrediction(parsed: any): ClassifierPrediction {
    const category: string = parsed.category;
    const rawConf =
      typeof parsed.categoryConfidence === "number"
        ? parsed.categoryConfidence
        : typeof parsed.confidence === "number"
          ? parsed.confidence
          : 0.5;
    const confidence = Math.max(0, Math.min(1, rawConf));

    // Map GLiNER heads to ClassifierHeads (all optional downstream)
    const heads: ClassifierHeads = {
      finished: parsed.finished === "yes" ? "yes" : parsed.finished === "no" ? "no" : undefined,
      policy: typeof parsed.policy === "string" ? parsed.policy : undefined,
      slopScore: typeof parsed.slopScore === "number" ? parsed.slopScore : undefined,
      urgency: typeof parsed.urgency === "string" ? parsed.urgency : undefined,
      severity: typeof parsed.severity === "string" ? parsed.severity : undefined,
    };

    return {
      category,
      confidence,
      categoryConfidence: confidence,
      complexity: 0, // GLiNER decide doesn't compute complexity; default to 0
      needsStrongModel: 0,
      multiFile: 0,
      risk: 0,
      destructive: 0,
      heads,
    };
  }
}

/** Disabled / missing backend: always falls through. */
export class NullGlinerDecidePredictor implements HiveClassifier {
  readonly id = "gliner-decide";

  async predict(_task: string): Promise<null> {
    return null;
  }
}