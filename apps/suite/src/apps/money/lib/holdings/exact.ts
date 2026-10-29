// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ExactValue } from "./types";
import { requireValue } from "./validation";

export const ZERO = BigInt(0);
export const ONE = BigInt(1);
export const TEN = BigInt(10);

// Internal limits, independent of the 30-digit input limit. A work unit is one
// pair of 64-bit words for an addition, product or Euclidean remainder step.
export const MAX_ARITHMETIC_BITS = 4096;
export const MAX_ARITHMETIC_WORK = 4_194_304;
const MAX_INTEGER = (ONE << BigInt(MAX_ARITHMETIC_BITS)) - ONE;

/** One instance per holdings call, including replay and final valuation. */
export class ExactArithmetic {
  private remaining = MAX_ARITHMETIC_WORK;

  private charge(a: bigint, b: bigint): void {
    // Compare before converting to binary: even the size measurement is bounded.
    requireValue(
      a >= -MAX_INTEGER && a <= MAX_INTEGER && b >= -MAX_INTEGER && b <= MAX_INTEGER,
      "VALUE_TOO_LARGE",
    );
    const cost =
      Math.ceil(a.toString(2).replace("-", "").length / 64) *
      Math.ceil(b.toString(2).replace("-", "").length / 64);
    requireValue(cost <= this.remaining, "VALUE_TOO_LARGE");
    this.remaining -= cost;
  }

  product(a: bigint, b: bigint): bigint {
    this.charge(a, b);
    const absoluteA = a < ZERO ? -a : a;
    const absoluteB = b < ZERO ? -b : b;
    // Reject before allocating an oversized product, even if it would cancel.
    requireValue(absoluteA === ZERO || absoluteB <= MAX_INTEGER / absoluteA, "VALUE_TOO_LARGE");
    return a * b;
  }

  sum(a: bigint, b: bigint): bigint {
    this.charge(a, b);
    const result = a + b;
    requireValue(result >= -MAX_INTEGER && result <= MAX_INTEGER, "VALUE_TOO_LARGE");
    return result;
  }

  /** All denominators originate in positive scales, quantities or split components. */
  fraction(numerator: bigint, denominator = ONE): ExactValue {
    let a = numerator < ZERO ? -numerator : numerator;
    let b = denominator;
    while (b !== ZERO) {
      this.charge(a, b);
      [a, b] = [b, a % b];
    }
    return { numerator: numerator / a, denominator: denominator / a };
  }

  add(a: ExactValue, b: ExactValue): ExactValue {
    return this.fraction(
      this.sum(this.product(a.numerator, b.denominator), this.product(b.numerator, a.denominator)),
      this.product(a.denominator, b.denominator),
    );
  }

  subtract(a: ExactValue, b: ExactValue): ExactValue {
    return this.add(a, { numerator: -b.numerator, denominator: b.denominator });
  }

  multiply(a: ExactValue, numerator: bigint, denominator = ONE): ExactValue {
    return this.fraction(
      this.product(a.numerator, numerator),
      this.product(a.denominator, denominator),
    );
  }

  halfEven(value: ExactValue): bigint {
    this.charge(value.numerator, value.denominator);
    const negative = value.numerator < ZERO;
    const absolute = negative ? -value.numerator : value.numerator;
    let whole = absolute / value.denominator;
    const twiceRemainder = this.product(absolute % value.denominator, BigInt(2));
    if (
      twiceRemainder > value.denominator ||
      (twiceRemainder === value.denominator && whole % BigInt(2) !== ZERO)
    ) {
      whole = this.sum(whole, ONE);
    }
    return negative ? -whole : whole;
  }

  formatMoney(value: ExactValue, decimals: number): string {
    return formatScaled(this.halfEven(value), decimals);
  }
}

export function formatScaled(value: bigint, decimals: number): string {
  const negative = value < ZERO;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const text = decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
  return negative ? `-${text}` : text;
}
