// AUTHORED-BY Codex GPT-6.1-Sol
import type { TextRange, TextSelectors } from "./types";

export function validateRange({ start, end }: TextRange): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    throw new RangeError("A text selection must have non-negative integer start < end");
  }
}

/** Create both Web Annotation selectors without changing the supplied plain text. */
export function createSelectors(text: string, range: TextRange): TextSelectors {
  validateRange(range);
  const points = Array.from(text);
  const { start, end } = range;
  if (end > points.length)
    throw new RangeError("The selection is outside the plain-text projection");
  return {
    quote: {
      type: "TextQuoteSelector",
      exact: points.slice(start, end).join(""),
      prefix: points.slice(Math.max(0, start - 32), start).join(""),
      suffix: points.slice(end, end + 32).join(""),
    },
    position: { type: "TextPositionSelector", start, end },
  };
}
