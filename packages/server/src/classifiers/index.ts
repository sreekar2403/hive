import type { ClassifierPrediction, HiveClassifier } from "./types";
import { SubprocessLayaPredictor } from "../laya";
import { GlinerDecidePredictor } from "./glinerDecide";

/**
 * Never crashes boot. Callers must fall through to the next layer.
 */
export class NullClassifier implements HiveClassifier {
  readonly id = "off";

  async predict(_task: string): Promise<null> {
    return null;
  }
}

/** Adapts the Laya bridge (categoryConfidence) to HiveClassifier (confidence). */
class LayaClassifierAdapter implements HiveClassifier {
  readonly id = "laya";
  constructor(private timeoutMs = 1500) {}
  async predict(task: string): Promise<ClassifierPrediction | null> {
    const pred = await new SubprocessLayaPredictor(this.timeoutMs).predict(task);
    if (!pred) return null;
    return {
      category: pred.category,
      confidence: pred.categoryConfidence,
      categoryConfidence: pred.categoryConfidence,
      complexity: pred.complexity,
      needsStrongModel: pred.needsStrongModel,
      multiFile: pred.multiFile,
      risk: pred.risk,
      destructive: pred.destructive,
    };
  }
}

/** Registry: getClassifier(backend) returns HiveClassifier; unknown → NullClassifier. */
export function getClassifier(backend: string, timeoutMs = 1500): HiveClassifier {
  switch (backend) {
    case "laya":
      return new LayaClassifierAdapter(timeoutMs);
    case "gliner-decide":
      return new GlinerDecidePredictor(timeoutMs);
    case "off":
    default:
      return new NullClassifier();
  }
}