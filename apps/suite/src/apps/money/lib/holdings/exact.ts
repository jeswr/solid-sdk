// AUTHORED-BY Codex GPT-6.1-Sol
import type { ExactValue } from "./types";

export const ZERO = BigInt(0);
export const ONE = BigInt(1);
export const TEN = BigInt(10);

/** All denominators originate in positive scales, quantities or split components. */
export function fraction(numerator: bigint, denominator = ONE): ExactValue {
  let a = numerator < ZERO ? -numerator : numerator;
  let b = denominator;
  while (b !== ZERO) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

export function add(a: ExactValue, b: ExactValue): ExactValue {
  return fraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function subtract(a: ExactValue, b: ExactValue): ExactValue {
  return add(a, { numerator: -b.numerator, denominator: b.denominator });
}

export function multiply(a: ExactValue, numerator: bigint, denominator = ONE): ExactValue {
  return fraction(a.numerator * numerator, a.denominator * denominator);
}

export function halfEven(value: ExactValue): bigint {
  const negative = value.numerator < ZERO;
  const absolute = negative ? -value.numerator : value.numerator;
  let whole = absolute / value.denominator;
  const twiceRemainder = (absolute % value.denominator) * BigInt(2);
  if (
    twiceRemainder > value.denominator ||
    (twiceRemainder === value.denominator && whole % BigInt(2) !== ZERO)
  ) {
    whole += ONE;
  }
  return negative ? -whole : whole;
}

export function formatScaled(value: bigint, decimals: number): string {
  const negative = value < ZERO;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const text = decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
  return negative ? `-${text}` : text;
}

export function formatMoney(value: ExactValue, decimals: number): string {
  return formatScaled(halfEven(value), decimals);
}
