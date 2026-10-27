// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { MatchRange, SearchSnippet } from "./types";
import { MAX_SNIPPET_LENGTH } from "./validation";

/** Internal: source/ranges have been validated and mapped from complete code points. */
export function makeSnippet(source: string, matches: readonly MatchRange[]): SearchSnippet {
  const sorted = [...matches].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const first = sorted[0]?.[0] ?? 0;
  let start = Math.max(0, Math.min(first - 40, source.length - (MAX_SNIPPET_LENGTH - 2)));
  // A low surrogate at a cut means the cut falls inside a pair.
  if (/[\uDC00-\uDFFF]/u.test(source.charAt(start))) start--;
  const prefix = start > 0 ? "…" : "";
  let end = Math.min(source.length, start + MAX_SNIPPET_LENGTH - prefix.length);
  const suffix = end < source.length ? "…" : "";
  end -= suffix.length;
  if (/[\uDC00-\uDFFF]/u.test(source.charAt(end))) end--;
  const ranges: [number, number][] = [];
  for (const [matchStart, matchEnd] of sorted) {
    const left = Math.max(start, matchStart);
    const right = Math.min(end, matchEnd);
    if (left >= right) continue;
    const shifted: [number, number] = [left - start + prefix.length, right - start + prefix.length];
    const previous = ranges.at(-1);
    if (previous && previous[1] >= shifted[0]) previous[1] = Math.max(previous[1], shifted[1]);
    else ranges.push(shifted);
  }
  return { text: prefix + source.slice(start, end) + suffix, ranges };
}
