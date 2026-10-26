// AUTHORED-BY Codex GPT-6.1-Sol
import type { TextRange } from "./types";

export interface FuzzyRange extends TextRange {
  edits: number;
}

// Per call: pattern setup, Bitap word updates and conservative recovery-cell estimates.
// Exhaustion discards all candidates so a partial search cannot pick a misleading winner.
const MAX_WORK = 10_000_000;

// All typed-array indices below are bounded by the allocated row/chunk length.
const at = (row: Uint32Array | Float64Array, index: number): number => row[index] as number;

/** Recover all equally good starts for an endpoint with a banded reverse edit-distance pass. */
function recoverStarts(
  text: readonly string[],
  pattern: readonly string[],
  end: number,
  edits: number,
  low: number,
  high: number,
): FuzzyRange[] {
  const width = Math.min(end - low, pattern.length + edits);
  let previous = new Float64Array(width + 1).fill(Infinity);
  let current = new Float64Array(width + 1).fill(Infinity);
  for (let j = 0; j <= Math.min(width, edits); j++) previous[j] = j;
  for (let i = 1; i <= pattern.length; i++) {
    current[0] = i <= edits ? i : Infinity;
    const first = Math.max(1, i - edits);
    const last = Math.min(width, i + edits);
    // Reset only the band edges, avoiding a full-width fill on every pattern row.
    if (first > 1) current[first - 1] = Infinity;
    if (last < width) current[last + 1] = Infinity;
    for (let j = first; j <= last; j++) {
      current[j] = Math.min(
        at(previous, j) + 1,
        at(current, j - 1) + 1,
        at(previous, j - 1) + Number(pattern[pattern.length - i] !== text[end - j]),
      );
    }
    [previous, current] = [current, previous];
  }
  const ranges: FuzzyRange[] = [];
  for (let length = Math.max(1, pattern.length - edits); length <= width; length++) {
    const start = end - length;
    if (start <= high && at(previous, length) === edits) ranges.push({ start, end, edits });
  }
  return ranges;
}

/**
 * Shift-And Bitap with Levenshtein error levels and 32-code-point pattern words.
 * Carries cross every word boundary, including deletion state, so long quotes
 * are matched as one contiguous pattern rather than independent chunk hits.
 * Search cost O(window length × ceil(quote length / 32) × (maxEdits + 1));
 * setup + scan + endpoint recovery share a 10,000,000-unit work budget.
 * Over-budget searches return no ranges, including any found before exhaustion.
 */
export function findFuzzyRanges(
  text: readonly string[],
  pattern: readonly string[],
  expected: number,
  radius: number,
  maxEdits: number,
): FuzzyRange[] {
  const low = Math.max(0, expected - radius);
  const high = Math.min(text.length, expected + radius);
  const limit = Math.min(text.length, high + pattern.length + maxEdits);
  const errors = Math.min(maxEdits, pattern.length - 1);
  const words = Math.ceil(pattern.length / 32);
  // Reserve the entire scan before building masks or allocating matcher state.
  // The extra scan step covers initial error-level state allocation.
  const scanWork = pattern.length + (limit - low + 1) * words * (errors + 1);
  if (scanWork > MAX_WORK) return [];
  let remainingWork = MAX_WORK - scanWork;
  // Sparse word masks use O(quote length) space even for many distinct code points.
  const masks = new Map<string, Map<number, number>>();
  for (const [index, point] of pattern.entries()) {
    let mask = masks.get(point);
    if (!mask) {
      mask = new Map<number, number>();
      masks.set(point, mask);
    }
    const word = Math.floor(index / 32);
    mask.set(word, (mask.get(word) ?? 0) | (1 << (index % 32)));
  }
  const emptyMask = new Map<number, number>();
  let state: Uint32Array[] = Array.from({ length: errors + 1 }, (_, error) => {
    const row = new Uint32Array(words);
    // Empty text matches prefixes through deletions; 32 needs a full word,
    // since JavaScript shifts reduce their count modulo 32.
    row[0] = error === 32 ? 0xffffffff : (1 << error) - 1;
    return row;
  });
  const finalBit = 1 << ((pattern.length - 1) % 32);
  let bestEdits = errors;
  let ranges: FuzzyRange[] = [];
  for (let index = low; index < limit; index++) {
    const mask = masks.get(text[index] as string) ?? emptyMask;
    const next: Uint32Array[] = [];
    for (let error = 0; error <= errors; error++) {
      const old = state[error] as Uint32Array;
      const row = new Uint32Array(words);
      let matchCarry = 1;
      let substitutionCarry = 1;
      let deletionCarry = 1;
      for (let word = 0; word < words; word++) {
        const oldWord = at(old, word);
        let value = ((oldWord << 1) | matchCarry) & (mask.get(word) ?? 0);
        matchCarry = oldWord >>> 31;
        if (error > 0) {
          const fewer = at(state[error - 1] as Uint32Array, word);
          const updatedFewer = at(next[error - 1] as Uint32Array, word);
          value |= (fewer << 1) | substitutionCarry | fewer | (updatedFewer << 1) | deletionCarry;
          substitutionCarry = fewer >>> 31;
          deletionCarry = updatedFewer >>> 31;
        }
        row[word] = value;
      }
      next.push(row);
    }
    state = next;
    for (let error = 0; error <= bestEdits; error++) {
      if ((at(state[error] as Uint32Array, words - 1) & finalBit) !== 0) {
        // Bound band cells, row initialization and range enumeration before recovery.
        const recoveryWork =
          (pattern.length + 1) * (2 * error + 1) + 3 * (pattern.length + error + 1);
        if (recoveryWork > remainingWork) return [];
        remainingWork -= recoveryWork;
        const recovered = recoverStarts(text, pattern, index + 1, error, low, high);
        if (recovered.length > 0) {
          if (error < bestEdits) ranges = [];
          bestEdits = error;
          ranges.push(...recovered);
          break;
        }
      }
    }
  }
  return ranges;
}
