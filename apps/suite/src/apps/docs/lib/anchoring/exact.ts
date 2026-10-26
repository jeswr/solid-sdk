// AUTHORED-BY Codex GPT-6
import type { TextRange } from "./types";

/** KMP overlapping search in O(text + pattern) work; pattern must be non-empty.
 * Comparing code points directly rejects hits inside UTF-16 surrogate pairs.
 */
export function findExactRanges(text: readonly string[], pattern: readonly string[]): TextRange[] {
  const fallback = new Uint32Array(pattern.length);
  for (let index = 1, matched = 0; index < pattern.length; index++) {
    while (matched > 0 && pattern[index] !== pattern[matched]) {
      matched = fallback[matched - 1] as number;
    }
    if (pattern[index] === pattern[matched]) matched++;
    fallback[index] = matched;
  }
  const ranges: TextRange[] = [];
  let matched = 0;
  for (const [index, point] of text.entries()) {
    while (matched > 0 && point !== pattern[matched]) {
      matched = fallback[matched - 1] as number;
    }
    if (point === pattern[matched]) matched++;
    if (matched === pattern.length) {
      ranges.push({ start: index + 1 - matched, end: index + 1 });
      matched = fallback[matched - 1] as number;
    }
  }
  return ranges;
}
