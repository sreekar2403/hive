/**
 * Whether a "description" is really the model saying it cannot look.
 *
 * A refusal arrives as a *successful* run — exit 0, real prose — so nothing
 * about the result object distinguishes it from a description. Passed
 * through, it lands in a block labelled "this is what the image contains",
 * and the working agent reads "does not support image input" as a fact
 * about the picture.
 *
 * Seen for real: Ollama reports ornith-1.5 as vision-capable and it is, but
 * opencode gates image input on its own per-model config, which the Ollama
 * provider block did not declare. The model can see; that route to it could
 * not. Image capability belongs to the harness-and-model pair, not the
 * model, so no catalog lookup can replace this check.
 *
 * The test is anchored deliberately tightly: an inability *about the
 * model's own faculties*, stated near the start of a short reply. A real
 * description may easily contain "image" and "cannot" — "the user cannot
 * see the password field" — and discarding a good description is the worse
 * error, since this only decides whether to fall back to naming the file.
 */

const INABILITY =
  /\b(?:can(?:'|no)?t|cannot|unable to|do(?:es)?\s+not|don'?t)\b[^.]{0,40}?\b(?:read|see|view|open|process|support|display|access|analyse|analyze)\b/;

const VISUAL =
  /\b(?:image|images|picture|photo|screenshot|visual|attachment|file)\b/;

/** Answers longer than this are describing something, not declining to. */
const MAX_REFUSAL_CHARS = 600;

export function looksLikeRefusal(text: string): boolean {
  if (text.length > MAX_REFUSAL_CHARS) return false;
  const head = text.slice(0, 240).toLowerCase();
  return INABILITY.test(head) && VISUAL.test(head);
}
