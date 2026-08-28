import type { RoutingRule } from "../config";

/**
 * Which task type a prompt looks like, using the *same* rules table the
 * Router routes by (Settings → Task routing).
 *
 * Sharing that table matters: if the brain filed a lesson under `refactor`
 * but the router would have called the same prompt `docs`, retrieval would
 * quietly never find it again. One classifier, one vocabulary.
 */
export function categorize(prompt: string, rules: RoutingRule[] = []): string {
  const query = prompt.toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled || rule.taskType === "default" || !rule.pattern) continue;
    try {
      if (new RegExp(rule.pattern, "i").test(query)) return rule.taskType;
    } catch {
      // Malformed pattern saved through the UI — skip it, exactly as the
      // Router does, rather than letting it break classification.
      continue;
    }
  }

  return "general";
}

/**
 * Content words from a prompt, for tag-based retrieval. Stopwords and the
 * imperative verbs that open almost every prompt ("add", "fix", "make")
 * carry no signal, so they are dropped — matching on them would make every
 * record look relevant to every task.
 */
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "then",
  "so",
  "than",
  "too",
  "can",
  "will",
  "would",
  "should",
  "could",
  "do",
  "does",
  "did",
  "not",
  "no",
  "please",
  "i",
  "we",
  "you",
  "my",
  "our",
  "me",
  "us",
  "also",
  "just",
  "now",
  "add",
  "fix",
  "make",
  "update",
  "change",
  "create",
  "use",
  "using",
  "want",
  "need",
  "help",
  "let",
  "get",
  "set",
  "put",
  "run",
  "work",
  "working",
]);

export function keywords(prompt: string, limit = 8): string[] {
  const counts = new Map<string, number>();

  for (const raw of prompt.toLowerCase().split(/[^a-z0-9_.-]+/)) {
    const word = raw.replace(/^[.-]+|[.-]+$/g, "");
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}
