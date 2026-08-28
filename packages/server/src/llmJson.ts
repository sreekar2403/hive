/**
 * Pulling a JSON object out of a model's answer.
 *
 * Every CLI here is a chat agent, not a JSON endpoint: asked for an object
 * it will often wrap one in prose, a code fence, or a preamble about what
 * it decided. Scanning for the first balanced `{…}` is what makes "sure,
 * here's the plan: {…}" usable without a second round trip.
 *
 * String-aware on purpose — a brace inside a quoted value must not close
 * the object, which a naive depth count gets wrong on exactly the prompts
 * that matter (they quote file paths and code).
 */
export function extractJsonObject(
  text: string,
): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
