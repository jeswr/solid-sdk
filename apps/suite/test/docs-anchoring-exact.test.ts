// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { createSelectors, reanchor } from "../src/apps/docs/lib/anchoring";
import { findExactRanges } from "../src/apps/docs/lib/anchoring/exact";

it("agrees with a code-point oracle including overlaps, fallback chains and surrogate boundaries", () => {
  for (const quote of ["a", "aaa", "ababac", "aabaaab", "🌱", "\ud800", "\udc00", "🌱a🌱"]) {
    const pattern = Array.from(quote);
    for (const value of [
      "",
      "aaaaa",
      "ababababac",
      "aabaabaabaaab",
      "🌱a🌱a🌱",
      "𐀀\ud800x\udc00",
    ]) {
      const text = Array.from(value);
      const expected = [];
      for (let start = 0; start + pattern.length <= text.length; start++) {
        if (pattern.every((point, index) => point === text[start + index])) {
          expected.push({ start, end: start + pattern.length });
        }
      }
      expect(findExactRanges(text, pattern)).toEqual(expected);
    }
  }
});

it.each([
  "a".repeat(8192),
  `${"a".repeat(8191)}b`,
])("bounds code-point reads linearly for repetitive quotes (overlaps and near misses)", (quote) => {
  let reads = 0;
  function counted(value: string): readonly string[] {
    return new Proxy(Array.from(value), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
  }
  const text = counted("a".repeat(32768));
  const pattern = counted(quote);
  const ranges = findExactRanges(text, pattern);
  expect(ranges.length).toBe(quote.endsWith("b") ? 0 : text.length - pattern.length + 1);
  expect(reads).toBeLessThan(6 * (text.length + pattern.length));
});

it("ranks many overlapping long exact hits without reconstructing each quote", () => {
  const quote = "🌱".repeat(8192);
  const selectors = createSelectors(`x${quote}`, { start: 1, end: 8193 });
  // Move the original position outside the document to force the overlapping exact search.
  const moved = reanchor("🌱".repeat(32768), {
    ...selectors,
    position: { ...selectors.position, start: 40000, end: 48192 },
  });
  expect(moved).toMatchObject({ method: "quote", range: { start: 24576, end: 32768 } });
});
