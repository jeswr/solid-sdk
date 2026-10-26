// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

export type SearchIndexErrorCode =
  | "invalid-input"
  | "unsupported-runtime"
  | "duplicate-id"
  | "not-found"
  | "invalid-snapshot";

export class SearchIndexError extends Error {
  override readonly name = "SearchIndexError";
  constructor(
    readonly code: SearchIndexErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SearchToken {
  term: string;
  /** Original half-open UTF-16 grapheme bounds; expansions can share source ranges. */
  start: number;
  end: number;
}

export function validateText(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.isWellFormed()) {
    throw new SearchIndexError("invalid-input", "Expected well-formed Unicode text");
  }
}

export function segmenter(granularity: "word" | "grapheme"): Intl.Segmenter {
  if (typeof Intl.Segmenter !== "function") {
    throw new SearchIndexError("unsupported-runtime", "Intl.Segmenter is required");
  }
  // Fixed locale: indexing and querying must not depend on the device's default locale.
  return new Intl.Segmenter("en", { granularity });
}

/** Default (non-Turkic) case folding, compatibility normalization and mark removal. */
function fold(value: string): string {
  let result = "";
  for (const character of value.normalize("NFKD")) {
    if (character === "ı") result += character;
    // Unicode default folding preserves Cherokee uppercase as its canonical form.
    else if (/[\u13a0-\u13f5\u13f8-\u13fd\uab70-\uabbf]/u.test(character)) {
      result += character.toUpperCase();
    } else result += character.toUpperCase().toLowerCase();
  }
  // Per-code-point casing avoids contextual final sigma. Capital sharp S needs this
  // extra expansion; lower sharp S is already expanded by upper/lower casing.
  return result.replaceAll("ß", "ss").normalize("NFKD").replace(/\p{M}/gu, "");
}

/**
 * Words only; punctuation and emoji are separators. No stemming or query syntax.
 * Segment after folding so equivalent normalized text has identical word boundaries.
 * Each folded UTF-16 unit maps to its entire source grapheme, including removed marks
 * and expansions into multiple words, so source offsets remain safe for highlighting.
 */
export function tokenize(text: string): SearchToken[] {
  validateText(text);
  const tokens: SearchToken[] = [];
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const part of segmenter("grapheme").segment(text)) {
    const folded = fold(part.segment);
    normalized += folded;
    for (let offset = 0; offset < folded.length; offset++) {
      starts.push(part.index);
      ends.push(part.index + part.segment.length);
    }
  }
  for (const part of segmenter("word").segment(normalized)) {
    if (part.isWordLike) {
      tokens.push({
        term: part.segment,
        start: starts[part.index] as number,
        end: ends[part.index + part.segment.length - 1] as number,
      });
    }
  }
  return tokens;
}

export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      tokenize(query)
        .map((token) => token.term)
        .reverse(),
    ),
  ].reverse();
}

export function matches(term: string, terms: readonly string[]): boolean {
  return terms.some((query, index) =>
    index === terms.length - 1 ? term.startsWith(query) : term === query,
  );
}
