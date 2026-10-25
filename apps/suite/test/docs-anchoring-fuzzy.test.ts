// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { createSelectors, reanchor } from "../src/apps/docs/lib/anchoring";
import { findFuzzyRanges } from "../src/apps/docs/lib/anchoring/fuzzy";

// Deliberately simple full-matrix oracle, independent of Bitap and banded recovery.
function distance(a: string[], b: string[]): number {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      (matrix[i] as number[])[j] = Math.min(
        ((matrix[i - 1] as number[])[j] as number) + 1,
        ((matrix[i] as number[])[j - 1] as number) + 1,
        ((matrix[i - 1] as number[])[j - 1] as number) + Number(a[i - 1] !== b[j - 1]),
      );
    }
  }
  return (matrix[a.length] as number[])[b.length] as number;
}

it("agrees with an exhaustive edit-distance oracle across texts, error limits and start bounds", () => {
  const patterns = ["a", "ab", "aaa", "aba", "aabb", "ababa", "🌱a🪴"];
  const texts = ["", "a", "b", "aaaa", "baba", "aabbaa", "zzabxaba", "🌱🪴", "b🌱a🪴z"];
  for (const patternText of patterns) {
    const pattern = Array.from(patternText);
    for (const textValue of texts) {
      const text = Array.from(textValue);
      for (const expected of [0, Math.floor(text.length / 2), text.length]) {
        for (const radius of [0, 1, 10]) {
          for (const maxEdits of [0, 1, 2, 3]) {
            const limit = Math.min(maxEdits, pattern.length - 1);
            const oracle = [];
            for (
              let start = Math.max(0, expected - radius);
              start <= Math.min(text.length, expected + radius);
              start++
            ) {
              for (let end = start + 1; end <= text.length; end++) {
                const edits = distance(pattern, text.slice(start, end));
                if (edits <= limit) oracle.push({ start, end, edits });
              }
            }
            const best = Math.min(...oracle.map(({ edits }) => edits));
            const sort = (a: { start: number; end: number }, b: { start: number; end: number }) =>
              a.start - b.start || a.end - b.end;
            expect(
              findFuzzyRanges(text, pattern, expected, radius, maxEdits).sort(sort),
              JSON.stringify({ patternText, textValue, expected, radius, maxEdits }),
            ).toEqual(oracle.filter(({ edits }) => edits === best).sort(sort));
          }
        }
      }
    }
  }
});

it("does not treat lone surrogates as exact matches inside an astral code point", () => {
  const low = createSelectors("\udc00", { start: 0, end: 1 });
  const high = createSelectors("\ud800", { start: 0, end: 1 });
  expect(reanchor("x𐀀x𐀀", low)).toEqual({ status: "orphan", confidence: 0 });
  expect(reanchor("x𐀀", high)).toEqual({ status: "orphan", confidence: 0 });
});

it("agrees with the oracle for edits crossing 32-bit word boundaries", () => {
  for (const length of [31, 32, 33, 64, 65]) {
    const original = Array.from({ length }, (_, i) => String.fromCodePoint(0x400 + i));
    for (const changed of [
      original.filter((_, i) => i < 30 || i > 33),
      [...original.slice(0, 31), "🌱", "🪴", ...original.slice(31)],
      original.map((point, i) => (i >= 30 && i <= 33 ? "☀" : point)),
    ]) {
      const text = [...Array.from("xxx"), ...changed, ...Array.from("zzz")];
      const oracle = [];
      for (let start = 1; start <= 5; start++) {
        for (let end = start + 1; end <= text.length; end++) {
          const edits = distance(original, text.slice(start, end));
          if (edits <= 4) oracle.push({ start, end, edits });
        }
      }
      const best = Math.min(...oracle.map(({ edits }) => edits));
      const sort = (a: { start: number; end: number }, b: { start: number; end: number }) =>
        a.start - b.start || a.end - b.end;
      expect(findFuzzyRanges(text, original, 3, 2, 4).sort(sort)).toEqual(
        oracle.filter(({ edits }) => edits === best).sort(sort),
      );
    }
  }
});

it("re-anchors a long, diverse quote without dropping its interior", () => {
  const original = Array.from({ length: 1024 }, (_, i) => String.fromCodePoint(0x400 + i));
  const changed = [...original];
  changed.splice(511, 1, "🌱", "🪴");
  const result = reanchor(
    `Note: ${changed.join("")} done.`,
    createSelectors(`Note: ${original.join("")} done.`, { start: 6, end: 1030 }),
  );
  expect(result.status).toBe("anchored");
  if (result.status !== "anchored") throw new Error("Expected long quote to match");
  expect(result.range).toEqual({ start: 6, end: 1031 });
  expect(result.confidence).toBe(1 - 2 / 1024);
  expect(result.selectors.quote.exact).toBe(changed.join(""));
});
