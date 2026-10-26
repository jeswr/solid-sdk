// AUTHORED-BY Codex GPT-6.1-Sol
import { matches, queryTerms, SearchIndexError, segmenter, tokenize } from "./text";

export interface HighlightRange {
  start: number;
  end: number;
}

export interface SearchSnippet {
  text: string;
  /** Half-open UTF-16 source offsets; highlights are relative to text. No injected HTML. */
  start: number;
  end: number;
  highlights: HighlightRange[];
}

/**
 * A grapheme-safe window around the first matching word (or the beginning if none).
 * maxLength is a positive safe integer in graphemes, a soft cap enlarged to include
 * the complete first matching word. Whole matching words are highlighted, including
 * prefix matches. No ellipses are inserted, so offsets always address original text.
 */
export function createSnippet(text: string, query: string, maxLength = 160): SearchSnippet {
  const tokens = tokenize(text);
  const terms = queryTerms(query);
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
    throw new SearchIndexError("invalid-input", "Snippet length must be a positive safe integer");
  }
  const hits = tokens.filter((token) => matches(token.term, terms));
  const boundaries = [...segmenter("grapheme").segment(text)].map((part) => part.index);
  boundaries.push(text.length);
  const first = hits[0];
  const hitStart = first ? boundaries.indexOf(first.start) : 0;
  const hitEnd = first ? boundaries.indexOf(first.end) : 0;
  const length = Math.max(maxLength, hitEnd - hitStart);
  const left = Math.max(0, hitStart - Math.floor((length - (hitEnd - hitStart)) / 2));
  const right = Math.min(boundaries.length - 1, left + length);
  const start = boundaries[Math.max(0, right - length)] as number;
  const end = boundaries[right] as number;
  return {
    text: text.slice(start, end),
    start,
    end,
    highlights: hits
      .filter((hit) => hit.start >= start && hit.end <= end)
      .map((hit) => ({ start: hit.start - start, end: hit.end - start })),
  };
}
