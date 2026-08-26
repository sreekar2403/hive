import type { Harness } from "@hive/shared/harness";
import { resolveModelRef } from "../models/catalog";
import type { Synthesizer } from "./learningAgent";
import type { BrainRecord } from "./types";

/**
 * The optional LLM half of the learning agent.
 *
 * The heuristics in learningAgent.ts can count and compare, but they can't
 * *notice* — they will never observe that three unrelated corrections all
 * amount to "stop writing so much prose in commit messages". That is what
 * this is for, and it runs only in the periodic batch, never on the hot path.
 *
 * It reuses whichever harness CLI is already installed rather than adding a
 * provider SDK: Hive's whole premise is that those CLIs are present and
 * authenticated, so a second auth path would be a second thing to break.
 */

/** How long the synthesis call gets before we give up on it. */
const SYNTHESIS_TIMEOUT_MS = 90_000;

/** Cap the evidence we hand over, so one batch can't send a huge prompt. */
const MAX_RECORDS = 40;
const MAX_SOUL_ENTRIES = 40;

export function createHarnessSynthesizer(
  harnesses: Map<string, Harness>,
  modelId: string,
  cwd?: string,
): Synthesizer | null {
  if (!modelId?.trim()) return null;

  return {
    async propose({ records, soul }) {
      const resolved = await resolveModelRef(modelId);
      if (!resolved) return [];

      const harness = harnesses.get(resolved.harness);
      if (!harness) return [];
      if (!(await harness.isAvailable())) return [];

      const result = await harness.execute(
        buildPrompt(records.slice(0, MAX_RECORDS), soul.slice(0, MAX_SOUL_ENTRIES)),
        {
          cwd,
          model: resolved.ref,
          timeout: SYNTHESIS_TIMEOUT_MS,
        },
      );

      if (!result.success) return [];
      return parseProposals(result.output);
    },
  };
}

/**
 * The synthesis prompt. Two things it insists on, both learned the hard way
 * from what these files are for: entries must be phrased as the *user's*
 * standing preference (soul.md is written in their voice), and the model
 * must decline rather than pad — an empty array is a valid, common answer.
 */
function buildPrompt(records: BrainRecord[], soul: string[]): string {
  const evidence = records
    .map(
      (r) =>
        `- [${r.store}/${r.shelf}] ${r.title} (confidence ${r.confidence.toFixed(
          2,
        )}, ${r.samples} observation${r.samples === 1 ? "" : "s"})`,
    )
    .join("\n");

  const existing = soul.length
    ? soul.map((s) => `- ${s}`).join("\n")
    : "(nothing recorded yet)";

  return `You are maintaining a file called soul.md: a short, standing description of how one developer likes to work. It is written in their voice, as preferences, not as a log of events.

Here is what has already been recorded in soul.md:
${existing}

Here is what has been observed about their recent work:
${evidence}

Propose at most 3 NEW entries for soul.md. Rules:
- Only propose something the evidence genuinely supports across multiple observations. One data point is not a preference.
- Do not restate anything already in soul.md above.
- Phrase each entry as a durable preference ("Prefers X over Y when Z"), not as an event ("Task 12 failed").
- If the evidence does not support any new entry, return an empty array. This is the correct answer more often than not.

Choose the section for each entry from exactly: Writing style, Document preferences, Ideation patterns, Skill choices, UI preferences, Harness preferences.

Reply with ONLY a JSON array, no prose and no code fence:
[{"section": "...", "entry": "...", "rationale": "...", "confidence": 0.0}]`;
}

/**
 * Pulls the JSON array out of the model's answer. Models wrap JSON in prose
 * and code fences no matter how firmly they are asked not to, so the first
 * bracketed array in the output is what counts — and anything unparseable
 * yields no suggestions rather than an error, since a failed synthesis
 * should cost the batch nothing.
 */
export function parseProposals(
  output: string,
): Array<{ section: string; entry: string; rationale: string; confidence: number }> {
  if (!output) return [];

  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : output;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const sections = new Set([
    "Writing style",
    "Document preferences",
    "Ideation patterns",
    "Skill choices",
    "UI preferences",
    "Harness preferences",
  ]);

  const out: Array<{
    section: string;
    entry: string;
    rationale: string;
    confidence: number;
  }> = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const entry = typeof row.entry === "string" ? row.entry.trim() : "";
    if (!entry) continue;

    // A section outside the agreed list would create a new heading in
    // soul.md on the model's whim; park it somewhere sensible instead.
    const section =
      typeof row.section === "string" && sections.has(row.section)
        ? row.section
        : "Ideation patterns";

    const confidence = Number(row.confidence);
    out.push({
      section,
      entry,
      rationale:
        typeof row.rationale === "string" ? row.rationale.trim() : "Synthesised from observations.",
      confidence: Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0.5,
    });
  }

  return out.slice(0, 3);
}
