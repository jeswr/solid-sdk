// AUTHORED-BY Codex GPT-6.1-Sol
import { assertText, NotesError } from "./validation";

/** Exact prefix of already projected plain text; no ellipsis, trimming, or HTML parsing. */
export function cardTextExcerpt(text: string, count: number): string {
  assertText(text);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new NotesError("invalid-input", "Grapheme limit must be a nonnegative safe integer");
  }
  if (typeof Intl.Segmenter !== "function") {
    throw new NotesError(
      "segmenter-unavailable",
      "Intl.Segmenter is required for grapheme excerpts",
    );
  }
  const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  let excerpt = "";
  let length = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (length === count) break;
    excerpt += segment;
    length += 1;
  }
  return excerpt;
}
