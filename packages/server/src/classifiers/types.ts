export interface ClassifierHeads {
  finished?: "yes" | "no";       // reply-acceptance: did the agent finish?
  policy?: string;               // moderation/slop: allow | personal_data | scam | spam | ...
  slopScore?: number;            // 0..1 ordinal mapped from 0..10 label
  urgency?: string;              // low | normal | high | critical
  severity?: string;             // info | low | medium | high | critical
}

export interface ClassifierPrediction {
  category: string;              // one of 9 Hive categories
  confidence: number;            // 0..1 (canonical)
  /** Alias kept for Laya-bridge compat; always mirrors confidence. */
  categoryConfidence: number;    // 0..1
  complexity: number;            // 0..2 scale (existing Laya semantics)
  needsStrongModel: number;      // 0..2
  multiFile: number;             // 0..2
  risk: number;                  // 0..2
  destructive: number;           // 0..2
  heads?: ClassifierHeads;       // optional generic heads, backend-dependent
}

export interface HiveClassifier {
  readonly id: string;           // "laya" | "gliner-decide" | "off" | future
  predict(task: string): Promise<ClassifierPrediction | null>;
}