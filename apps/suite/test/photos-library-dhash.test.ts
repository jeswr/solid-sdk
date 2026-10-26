// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { dHash, hammingDistance, isDuplicateCandidate } from "../src/apps/photos/lib/library";

const zeros = "0".repeat(64);
const ones = "1".repeat(64);
const sample = (pixel: (row: number, column: number) => number) =>
  Array.from({ length: 72 }, (_, index) => pixel(Math.floor(index / 9), index % 9));

describe("dHash", () => {
  it("hashes uniform, ascending and descending samples with strict greater-than comparisons", () => {
    expect(dHash(new Uint8Array(72).fill(255))).toBe(zeros);
    expect(dHash(sample(() => 0))).toBe(zeros);
    expect(dHash(sample((_, column) => column))).toBe(zeros);
    expect(dHash(sample((_, column) => 255 - column))).toBe(ones);
  });

  it("uses row-major bit order, keeps leading zeroes and never compares across row boundaries", () => {
    const pixels = Object.freeze(
      sample((row, column) => row * 20 + (row % 2 ? 8 - column : column)),
    );
    expect(dHash(pixels)).toBe("0000000011111111".repeat(4));
    expect(dHash(sample((row) => 8 - row))).toBe(zeros);
    expect(pixels).toEqual(sample((row, column) => row * 20 + (row % 2 ? 8 - column : column)));
  });

  it("accepts fractional grayscale and is unchanged by a uniform brightness shift", () => {
    const pixels = new Float32Array(sample((row, column) => row + (column % 2 ? 0.25 : 0.5)));
    expect(dHash(pixels)).toBe("10".repeat(32));
    expect(dHash(pixels.map((value) => value + 50))).toBe(dHash(pixels));
  });

  it.each([0, 64, 71, 73, 81])("rejects %s pixels", (length) => {
    expect(() => dHash(new Uint8Array(length))).toThrow(RangeError);
  });

  it.each([-1, 256, NaN, Infinity, -Infinity])("rejects invalid pixels %s anywhere", (value) => {
    for (const index of [0, 35, 71]) {
      const pixels = sample(() => 0);
      pixels[index] = value;
      expect(() => dHash(pixels)).toThrow(RangeError);
    }
  });

  it("rejects missing samples", () => {
    expect(() => dHash(new Array(72))).toThrow(RangeError);
  });
});

describe("dHash comparison", () => {
  it("compares all 64 bits, including the first and last", () => {
    expect(hammingDistance(zeros, zeros)).toBe(0);
    expect(hammingDistance(ones, ones)).toBe(0);
    expect(hammingDistance(zeros, ones)).toBe(64);
    expect(hammingDistance(ones, zeros)).toBe(64);
    expect(hammingDistance(zeros, `1${"0".repeat(62)}1`)).toBe(2);
    expect(hammingDistance("10".repeat(32), "01".repeat(32))).toBe(64);
  });

  it.each([
    "",
    "0".repeat(63),
    "0".repeat(65),
    "x".repeat(64),
    `${"0".repeat(63)}\n`,
    `${zeros}\n`,
  ])("rejects malformed hashes on either side (%j)", (hash) => {
    expect(() => hammingDistance(hash, zeros)).toThrow(RangeError);
    expect(() => hammingDistance(zeros, hash)).toThrow(RangeError);
    expect(() => isDuplicateCandidate(hash, zeros, 64)).toThrow(RangeError);
  });

  it("uses an inclusive caller-supplied threshold", () => {
    const changed = `1${"0".repeat(63)}`;
    expect(isDuplicateCandidate(zeros, zeros, 0)).toBe(true);
    expect(isDuplicateCandidate(zeros, changed, 0)).toBe(false);
    expect(isDuplicateCandidate(zeros, changed, 1)).toBe(true);
    expect(isDuplicateCandidate(zeros, changed, 2)).toBe(true);
    expect(isDuplicateCandidate(zeros, ones, 63)).toBe(false);
    expect(isDuplicateCandidate(zeros, ones, 64)).toBe(true);
  });

  it.each([-1, 65, 0.5, NaN, Infinity, -Infinity])("rejects invalid threshold %s", (value) => {
    expect(() => isDuplicateCandidate(zeros, ones, value)).toThrow(RangeError);
  });

  it("compares two synthetic image samples end to end", () => {
    const original = sample((_, column) => 10 + column);
    const changed = [...original];
    changed[0] = 12;
    expect(hammingDistance(dHash(original), dHash(changed))).toBe(1);
    expect(isDuplicateCandidate(dHash(original), dHash(changed), 1)).toBe(true);
  });
});
