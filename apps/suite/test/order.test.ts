// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateKeyBetween, generateNKeysBetween, rebalanceKeys } from "../src/lib/order";

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const canonicalKey = fc
  .array(fc.constantFrom(...alphabet), { maxLength: 40 })
  .map((digits) => `${digits.join("")}V`);
const bounds = fc
  .tuple(fc.option(canonicalKey, { nil: null }), fc.option(canonicalKey, { nil: null }))
  .filter(([a, b]) => a === null || b === null || a !== b)
  .map(([a, b]): [string | null, string | null] =>
    a !== null && b !== null && a > b ? [b, a] : [a, b],
  );

function assertSequence(keys: string[], lower: string | null, upper: string | null): void {
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys).toEqual([...keys].sort());
  for (const key of keys) {
    expect(key).toMatch(/^[0-9A-Za-z]*[1-9A-Za-z]$/);
    if (lower !== null) expect(lower < key).toBe(true);
    if (upper !== null) expect(key < upper).toBe(true);
  }
}

describe("fractional order keys", () => {
  it.each([
    [null, null, "V"],
    [null, "1", "0V"],
    [null, "0V", "0F"],
    [null, "0001", "0000V"],
    ["A", null, "a"],
    ["z", null, "zV"],
    ["A", "B", "AV"],
    ["Az", "B", "AzV"],
    ["A", "A1", "A0V"],
    ["A1", "A2", "A1V"],
    ["Z", "a", "ZV"],
    ["9", "A", "9V"],
    ["F", "V", "N"],
    ["sameV", "sameV0V", "sameV0F"],
  ])("generates between %s and %s", (lower, upper, expected) => {
    expect(generateKeyBetween(lower, upper)).toBe(expected);
    expect(generateKeyBetween(lower, upper)).toBe(generateKeyBetween(lower, upper));
    assertSequence([expected], lower, upper);
  });

  it.each([
    "",
    "0",
    "A0",
    "00",
    "-",
    "a_b",
    "a.b",
    " a",
    "a ",
    "a\n",
    "é",
    "💡",
  ])("rejects malformed bound %j through all entry points", (key) => {
    expect(() => generateKeyBetween(key, null)).toThrow(RangeError);
    expect(() => generateKeyBetween(null, key)).toThrow(RangeError);
    expect(() => generateNKeysBetween(key, null, 0)).toThrow(RangeError);
    expect(() => generateNKeysBetween(null, key, 0)).toThrow(RangeError);
    expect(() => rebalanceKeys([key])).toThrow(RangeError);
  });

  it.each([
    ["V", "V"],
    ["z", "A"],
    ["AV", "A"],
  ])("rejects equal or reversed bounds %s / %s", (lower, upper) => {
    expect(() => generateKeyBetween(lower, upper)).toThrow(RangeError);
    expect(() => generateNKeysBetween(lower, upper, 0)).toThrow(RangeError);
    expect(() => rebalanceKeys([lower, upper])).toThrow(RangeError);
  });

  it("returns balanced batches, including zero and one", () => {
    expect(generateNKeysBetween(null, null, 0)).toEqual([]);
    expect(generateNKeysBetween(null, null, 1)).toEqual([generateKeyBetween(null, null)]);
    expect(generateNKeysBetween(null, null, 2)).toEqual(["F", "V"]);
    expect(generateNKeysBetween(null, null, 3)).toEqual(["F", "V", "k"]);
    expect(generateNKeysBetween("A", "B", 1)).toEqual([generateKeyBetween("A", "B")]);
    expect(generateNKeysBetween(null, "V", 1)).toEqual([generateKeyBetween(null, "V")]);
    expect(generateNKeysBetween("V", null, 1)).toEqual([generateKeyBetween("V", null)]);
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid count %s", (count) =>
    expect(() => generateNKeysBetween(null, null, count)).toThrow(RangeError));

  it("rebalances without changing input, preserves positions and remains insertable", () => {
    const original = Object.freeze(["A0000000001", "A0000000002", "A0000000003"]);
    const compact = rebalanceKeys(original);
    expect(compact).toEqual(["F", "V", "k"]);
    expect(original).toEqual(["A0000000001", "A0000000002", "A0000000003"]);
    const items = original.map((key, i) => ({ id: `https://example.org/items/${i}`, key }));
    expect(items.map((item, i) => ({ ...item, key: compact[i] })).map(({ id }) => id)).toEqual(
      items.map(({ id }) => id),
    );
    assertSequence([generateKeyBetween(compact[0] ?? null, compact[1] ?? null)], "F", "V");
    expect(rebalanceKeys(compact)).toEqual(compact);
    expect(rebalanceKeys(compact)).not.toBe(compact);
    expect(rebalanceKeys([])).toEqual([]);
    expect(rebalanceKeys(["zzzzzzV"])).toEqual(["V"]);
  });

  it("handles long common prefixes iteratively", () => {
    const prefix = "A".repeat(20_000);
    expect(generateKeyBetween(`${prefix}1`, `${prefix}2`)).toBe(`${prefix}1V`);
  });

  it("supports repeated inserts at either end and inside a shrinking gap", () => {
    let first = "V";
    let last = "V";
    let inside = "AV";
    for (let i = 0; i < 1000; i += 1) {
      const before = generateKeyBetween(null, first);
      const after = generateKeyBetween(last, null);
      const middle = generateKeyBetween("A", inside);
      expect(before < first && after > last && "A" < middle && middle < inside).toBe(true);
      first = before;
      last = after;
      inside = middle;
    }
  });

  it("preserves ordering for arbitrary valid bounds and batches", () => {
    fc.assert(
      fc.property(bounds, fc.integer({ min: 0, max: 100 }), ([lower, upper], count) => {
        assertSequence([generateKeyBetween(lower, upper)], lower, upper);
        const keys = generateNKeysBetween(lower, upper, count);
        expect(keys).toHaveLength(count);
        assertSequence(keys, lower, upper);
        const compact = rebalanceKeys(keys);
        expect(compact).toHaveLength(count);
        assertSequence(compact, null, null);
      }),
      { seed: 20261025, numRuns: 200 },
    );
  });

  it("preserves every existing key during 10k random inserts per generated history", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 10_000, maxLength: 10_000 }), (positions) => {
        const keys: string[] = [];
        for (const position of positions) {
          const index = position % (keys.length + 1);
          const lower = keys[index - 1] ?? null;
          const upper = keys[index] ?? null;
          const key = generateKeyBetween(lower, upper);
          if ((lower !== null && lower >= key) || (upper !== null && key >= upper)) return false;
          keys.splice(index, 0, key);
        }
        expect(keys).toHaveLength(10_000);
        assertSequence(keys, null, null);
        const compact = rebalanceKeys(keys);
        assertSequence(compact, null, null);
        expect(Math.max(...compact.map((key) => key.length))).toBeLessThanOrEqual(3);
        return true;
      }),
      { seed: 20261025, numRuns: 5 },
    );
  });
});
