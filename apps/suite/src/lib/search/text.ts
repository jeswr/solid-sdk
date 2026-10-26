// AUTHORED-BY Codex GPT-6.1-Sol

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
  /** Half-open UTF-16 offsets into the original text, before normalization. */
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
 * Reject compatibility characters whose normalization changes word boundaries:
 * preserving original word offsets would otherwise silently change query meaning.
 */
export function tokenize(text: string): SearchToken[] {
  validateText(text);
  const tokens: SearchToken[] = [];
  const words = segmenter("word");
  for (const part of words.segment(text)) {
    const term = fold(part.segment);
    const foldedWords = [...words.segment(term)].filter((piece) => piece.isWordLike);
    if (
      part.isWordLike
        ? foldedWords.length !== 1 || foldedWords[0]?.segment !== term
        : foldedWords.length !== 0
    ) {
      throw new SearchIndexError("invalid-input", "Normalization changes word boundaries");
    }
    if (part.isWordLike) {
      tokens.push({
        term,
        start: part.index,
        end: part.index + part.segment.length,
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
