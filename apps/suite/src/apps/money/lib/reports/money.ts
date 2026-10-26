// AUTHORED-BY Codex GPT-6.1-Sol
import { type Currency, minorUnits } from "./currencies";
import { list, ReportsError, record } from "./validation";

export interface Money {
  readonly currency: Currency;
  readonly minor: number;
}

export interface ExchangeRate {
  readonly from: string;
  readonly to: string;
  /** Target major units per source major unit; exact positive decimal text. */
  readonly rate: string;
}

const ZERO = BigInt(0);
const TEN = BigInt(10);

export function money(currency: string, minor: number): Money {
  minorUnits(currency);
  if (!Number.isSafeInteger(minor)) throw new ReportsError("invalid-amount");
  return { currency: currency as Currency, minor: minor === 0 ? 0 : minor };
}

export function validateMoney(value: Money): void {
  record(value);
  money(value.currency, value.minor);
}

function checked(currency: string, minor: bigint): Money {
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ReportsError("overflow");
  }
  return money(currency, Number(minor));
}

function decimal(value: string, code: "invalid-amount" | "invalid-rate"): [bigint, number] {
  if (typeof value !== "string" || value.length > 1024 || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new ReportsError(code);
  }
  const fraction = value.split(".")[1] ?? "";
  return [BigInt(value.replace(".", "")), fraction.length];
}

/** Rejects numbers, exponent notation, locale separators and excess fractional digits. */
export function parseMoney(currency: string, value: string): Money {
  const digits = minorUnits(currency);
  const [coefficient, scale] = decimal(value, "invalid-amount");
  if (scale > digits) throw new ReportsError("invalid-amount");
  return checked(currency, coefficient * TEN ** BigInt(digits - scale));
}

export function formatMoney(value: Money): string {
  validateMoney(value);
  const digits = minorUnits(value.currency);
  const sign = value.minor < 0 ? "-" : "";
  const absolute = Math.abs(value.minor)
    .toString()
    .padStart(digits + 1, "0");
  if (digits === 0) return sign + absolute;
  return `${sign}${absolute.slice(0, -digits)}.${absolute.slice(-digits)}`;
}

function sameCurrency(a: Money, b: Money): void {
  validateMoney(a);
  validateMoney(b);
  if (a.currency !== b.currency) throw new ReportsError("currency-mismatch");
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return checked(a.currency, BigInt(a.minor) + BigInt(b.minor));
}

export function subtractMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return checked(a.currency, BigInt(a.minor) - BigInt(b.minor));
}

/** Fractional multipliers are rejected; currency conversion uses explicit rates instead. */
export function multiplyMoney(value: Money, multiplier: number): Money {
  validateMoney(value);
  if (!Number.isSafeInteger(multiplier)) throw new ReportsError("invalid-amount");
  return checked(value.currency, BigInt(value.minor) * BigInt(multiplier));
}

/** Validate the entire table, even unused rates and same-currency conversions. */
export function validateRates(rates: readonly ExchangeRate[]): void {
  list(rates);
  const pairs = new Set<string>();
  for (const rate of rates) {
    record(rate);
    minorUnits(rate.from);
    minorUnits(rate.to);
    const [coefficient] = decimal(rate.rate, "invalid-rate");
    if (coefficient <= ZERO || rate.from === rate.to) throw new ReportsError("invalid-rate");
    const pair = `${rate.from}/${rate.to}`;
    if (pairs.has(pair)) throw new ReportsError("duplicate");
    pairs.add(pair);
  }
}

/** Only direct rates; never rounds, inverts, triangulates or obtains rates via I/O. */
export function convertMoney(
  value: Money,
  currency: string,
  rates: readonly ExchangeRate[],
): Money {
  validateMoney(value);
  const targetDigits = minorUnits(currency);
  validateRates(rates);
  if (value.currency === currency) return money(currency, value.minor);
  const rate = rates.find((entry) => entry.from === value.currency && entry.to === currency);
  if (!rate) throw new ReportsError("missing-rate");
  const [coefficient, scale] = decimal(rate.rate, "invalid-rate");
  const numerator = BigInt(value.minor) * coefficient * TEN ** BigInt(targetDigits);
  const denominator = TEN ** BigInt(scale + minorUnits(value.currency));
  if (numerator % denominator !== ZERO) throw new ReportsError("inexact-conversion");
  return checked(currency, numerator / denominator);
}
