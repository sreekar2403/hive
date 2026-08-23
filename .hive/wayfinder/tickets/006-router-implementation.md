# Ticket: Router Implementation

**Label:** `wayfinder:task`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

How should the router match queries to harnesses and models? The spec defines the routing table but not the matching algorithm.

**Decision needed:**

- Is pattern matching keyword-based, regex, or LLM-classified?
- How are ties broken (multiple patterns match)?
- How does the user override work in practice (parse @syntax from query)?
- How does the router learn from past decisions?

**Considerations:**

- Keyword matching is fast but dumb (no semantic understanding)
- LLM classification is smart but slow and costs tokens
- Need a hybrid: fast path for obvious cases, slow path for ambiguous ones
- Override syntax must be parsed before routing

**Options:**

- A) Pure regex — simple, fast, no intelligence
- B) Keyword + score — count keyword matches, highest score wins
- C) Keyword first, LLM tiebreaker — fast for obvious, smart for ambiguous

**Recommendation:** C) Keyword first, LLM tiebreaker — best of both worlds. 90% of queries route on keywords alone.

## Resolution

**Decision: C) Keyword scoring with LLM tiebreaker + @override parsing**

### Routing Pipeline

```
User query
    │
    ▼
┌──────────────┐
│ Parse        │ ← extract @opus, @pi, etc.
│ Overrides    │   strip from query text
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Keyword      │ ← score each rule
│ Scoring      │   count matches
└──────┬───────┘
       │
   score > 0.7?
   ┌────┴────┐
   yes       no
   │         │
   ▼         ▼
 Use it   ┌──────────────┐
          │ LLM          │ ← ask haiku "classify this query"
          │ Tiebreaker   │
          └──────┬───────┘
                 │
                 ▼
            Use LLM result
```

### Override Parsing

```typescript
interface ParsedQuery {
  text: string; // query with overrides stripped
  modelOverride?: string; // e.g., 'opus', 'sonnet'
  harnessOverride?: string; // e.g., 'pi', 'opencode'
}

function parseOverrides(query: string): ParsedQuery {
  const overrides = query.match(/@(\w+)/g) || [];
  let text = query;
  let modelOverride: string | undefined;
  let harnessOverride: string | undefined;

  const knownModels = ["opus", "sonnet", "haiku", "turbo"];
  const knownHarnesses = ["opencode", "claude-code", "pi"];

  for (const override of overrides) {
    const name = override.slice(1); // remove @
    if (knownModels.includes(name)) modelOverride = name;
    if (knownHarnesses.includes(name)) harnessOverride = name;
    text = text.replace(override, "");
  }

  return { text: text.trim(), modelOverride, harnessOverride };
}
```

### Keyword Scoring

```typescript
interface RoutingRule {
  name: string;
  keywords: string[];
  harness: string;
  model: string;
  weight: number; // default 1.0, higher = stronger signal
}

const ROUTING_TABLE: RoutingRule[] = [
  {
    name: "frontend",
    keywords: [
      "component",
      "ui",
      "css",
      "style",
      "layout",
      "responsive",
      "accessibility",
      "tailwind",
      "react",
      "jsx",
      "tsx",
    ],
    harness: "opencode",
    model: "sonnet",
    weight: 1.0,
  },
  {
    name: "backend",
    keywords: [
      "api",
      "endpoint",
      "server",
      "database",
      "auth",
      "middleware",
      "express",
      "fastify",
    ],
    harness: "claude-code",
    model: "sonnet",
    weight: 1.0,
  },
  {
    name: "architecture",
    keywords: [
      "design",
      "architect",
      "system",
      "structure",
      "refactor",
      "scale",
      "pattern",
      "module",
    ],
    harness: "opencode",
    model: "opus",
    weight: 1.2, // architecture tasks get extra weight
  },
  {
    name: "devops",
    keywords: [
      "deploy",
      "ci",
      "docker",
      "nginx",
      "server",
      "infra",
      "kubernetes",
      "pipeline",
    ],
    harness: "claude-code",
    model: "sonnet",
    weight: 1.0,
  },
  {
    name: "research",
    keywords: [
      "find",
      "search",
      "compare",
      "evaluate",
      "investigate",
      "research",
      "lookup",
    ],
    harness: "pi",
    model: "haiku",
    weight: 0.8, // lower weight, more likely to hit tiebreaker
  },
];

function scoreRules(
  query: string,
): Array<{ rule: RoutingRule; score: number }> {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/);

  return ROUTING_TABLE.map((rule) => {
    const matches = rule.keywords.filter((kw) => words.includes(kw)).length;
    const score = (matches / rule.keywords.length) * rule.weight;
    return { rule, score };
  }).sort((a, b) => b.score - a.score);
}
```

### LLM Tiebreaker

When keyword score is below threshold (0.7) or top two are close (delta < 0.1):

```typescript
async function llmClassify(
  query: string,
): Promise<{ harness: string; model: string }> {
  const prompt = `Classify this coding query into exactly one category.
Categories: frontend, backend, architecture, devops, research

Query: "${query}"

Respond with JSON: { "category": "<category>" }`;

  // Use haiku (cheap, fast) for classification
  const response = await callLLM("haiku", prompt);
  const { category } = JSON.parse(response);

  const rule = ROUTING_TABLE.find((r) => r.name === category);
  return rule
    ? { harness: rule.harness, model: rule.model }
    : { harness: "opencode", model: "sonnet" };
}
```

### Full Route Function

```typescript
async function route(query: string): Promise<Route> {
  // 1. Parse overrides
  const parsed = parseOverrides(query);

  // 2. If harness override, use it directly
  if (parsed.harnessOverride) {
    return {
      harness: parsed.harnessOverride,
      model: parsed.modelOverride || getDefaultModel(parsed.harnessOverride),
      query: parsed.text,
      source: "override",
    };
  }

  // 3. Keyword scoring
  const scores = scoreRules(parsed.text);
  const top = scores[0];
  const second = scores[1];

  // 4. High confidence → use keyword result
  if (top.score > 0.7 || (second && top.score - second.score > 0.1)) {
    return {
      harness: top.rule.harness,
      model: parsed.modelOverride || top.rule.model,
      query: parsed.text,
      source: "keyword",
    };
  }

  // 5. Low confidence → LLM tiebreaker
  const llmResult = await llmClassify(parsed.text);
  return {
    harness: llmResult.harness,
    model: parsed.modelOverride || llmResult.model,
    query: parsed.text,
    source: "llm",
  };
}

interface Route {
  harness: string;
  model: string;
  query: string; // stripped of overrides
  source: "override" | "keyword" | "llm";
}
```

### No Learning (for now)

The router does NOT learn from past decisions. It uses the fixed routing table + LLM for ambiguous cases. Learning adds complexity (storing routing history, updating weights) — defer to a future iteration if the static table proves insufficient.
