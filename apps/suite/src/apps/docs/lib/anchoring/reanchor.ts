// AUTHORED-BY Codex GPT-6.1-Sol
import { findFuzzyRanges } from "./fuzzy";
import { createSelectors, validateRange } from "./selectors";
import type { AnchorResult, ReanchorOptions, TextRange, TextSelectors } from "./types";

function boundedInteger(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 0 and ${maximum}`);
  }
}

/** Rank duplicate matches by adjacent context, old-position proximity, then document order. */
function chooseRange(
  text: readonly string[],
  ranges: readonly TextRange[],
  selectors: TextSelectors,
): TextRange | undefined {
  const prefix = Array.from(selectors.quote.prefix).reverse();
  const suffix = Array.from(selectors.quote.suffix);
  function context({ start, end }: TextRange): number {
    let before = 0;
    while (before < prefix.length && prefix[before] === text[start - before - 1]) before++;
    let after = 0;
    while (after < suffix.length && suffix[after] === text[end + after]) after++;
    return before + after;
  }
  return [...ranges].sort(
    (a, b) =>
      context(b) - context(a) ||
      Math.abs(a.start - selectors.position.start) - Math.abs(b.start - selectors.position.start) ||
      a.start - b.start ||
      a.end - b.end,
  )[0];
}

/**
 * Re-anchor in a consistent caller-supplied plain-text projection (no normalization).
 * Position → global exact quote search → bounded fuzzy search; inputs are immutable.
 * Fuzzy confidence is 1 - edits / original quote length, with default threshold 0.5.
 * The supplied position must describe the original quote, but may now be out of bounds.
 * Existing editor marks and persistence are the consuming editor's responsibility.
 */
export function reanchor(
  text: string,
  selectors: TextSelectors,
  { threshold = 0.5, searchRadius = 1024, maxEdits = 32 }: ReanchorOptions = {},
): AnchorResult {
  validateRange(selectors.position);
  const pattern = Array.from(selectors.quote.exact);
  if (pattern.length !== selectors.position.end - selectors.position.start) {
    throw new RangeError("The original position length must equal the non-empty quote length");
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("threshold must be between 0 and 1");
  }
  boundedInteger(searchRadius, 4096, "searchRadius");
  boundedInteger(maxEdits, 32, "maxEdits");
  const points = Array.from(text);
  const { start, end } = selectors.position;
  function anchored(
    range: TextRange,
    method: "position" | "quote" | "fuzzy",
    confidence: number,
  ): AnchorResult {
    // Strip internal fuzzy edit counts from the public range.
    const selection = { start: range.start, end: range.end };
    return {
      status: "anchored",
      method,
      range: selection,
      confidence,
      selectors: createSelectors(text, selection),
    };
  }
  if (points.slice(start, end).join("") === selectors.quote.exact) {
    return anchored({ start, end }, "position", 1);
  }
  const exactRanges: TextRange[] = [];
  // Walk code point boundaries once while indexOf finds even overlapping hits.
  // Boundary validation also prevents a lone surrogate matching half an astral character.
  let unitOffset = 0;
  let pointOffset = 0;
  for (
    let offset = text.indexOf(selectors.quote.exact);
    offset !== -1;
    offset = text.indexOf(selectors.quote.exact, offset + 1)
  ) {
    while (unitOffset < offset) {
      unitOffset += (points[pointOffset] as string).length;
      pointOffset++;
    }
    if (
      unitOffset === offset &&
      points.slice(pointOffset, pointOffset + pattern.length).join("") === selectors.quote.exact
    ) {
      exactRanges.push({ start: pointOffset, end: pointOffset + pattern.length });
    }
  }
  const exact = chooseRange(points, exactRanges, selectors);
  if (exact) return anchored(exact, "quote", 1);
  const fuzzyRanges = findFuzzyRanges(
    points,
    pattern,
    Math.min(start, points.length),
    searchRadius,
    maxEdits,
  );
  const fuzzy = chooseRange(points, fuzzyRanges, selectors);
  if (!fuzzy) return { status: "orphan", confidence: 0 };
  const confidence = 1 - (fuzzyRanges[0] as { edits: number }).edits / pattern.length;
  if (confidence < threshold) return { status: "orphan", confidence };
  return anchored(fuzzy, "fuzzy", confidence);
}
