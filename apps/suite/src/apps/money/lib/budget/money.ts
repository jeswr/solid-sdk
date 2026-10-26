// AUTHORED-BY Codex GPT-6.1-Sol
import { BudgetError, checked, integer, list, record } from "./validation";

/** ISO 4217 subset: SIX List One, CcyMnrUnts; see README for the source. */
export const MINOR_UNITS = Object.freeze({
  AUD: 2,
  CAD: 2,
  CHF: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
  USD: 2,
} as const);

export type Currency = keyof typeof MINOR_UNITS;
export interface Money {
  readonly currency: Currency;
  readonly minor: number;
}

export function minorUnits(currency: string): number {
  if (typeof currency !== "string" || !Object.hasOwn(MINOR_UNITS, currency)) {
    throw new BudgetError("unsupported-currency");
  }
  return MINOR_UNITS[currency as Currency];
}

export function money(currency: string, minor: number): Money {
  minorUnits(currency);
  return { currency: currency as Currency, minor: integer(minor) };
}

export function validateMoney(value: Money): void {
  record(value);
  money(value.currency, value.minor);
}

/** Parse decimal text exactly. No exponents, locale separators, or rounding. */
export function parseMoney(currency: string, decimal: string): Money {
  const digits = minorUnits(currency);
  if (typeof decimal !== "string" || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(decimal)) {
    throw new BudgetError("invalid-amount");
  }
  const [whole, fraction = ""] = decimal.replace(/^-/, "").split(".") as [string, string?];
  if (fraction.length > digits) throw new BudgetError("invalid-amount");
  const absolute = BigInt(whole + fraction.padEnd(digits, "0"));
  const minor = decimal.startsWith("-") ? -absolute : absolute;
  return money(currency, checked(Number(minor)));
}

/** Fixed decimal text, without a currency symbol or locale formatting. */
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
  if (a.currency !== b.currency) throw new BudgetError("currency-mismatch");
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.currency, checked(a.minor + b.minor));
}

export function subtractMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.currency, checked(a.minor - b.minor));
}

/** Only integer multipliers; fractional allocation/rounding is unsupported. */
export function multiplyMoney(value: Money, multiplier: number): Money {
  validateMoney(value);
  integer(multiplier);
  return money(value.currency, checked(value.minor * multiplier));
}

/** Never converts currencies. Output currencies use UTF-16 ascending order. */
export function groupMoney(values: readonly Money[]): Money[] {
  list(values);
  const totals = new Map<Currency, number>();
  for (const value of values) {
    validateMoney(value);
    totals.set(value.currency, checked((totals.get(value.currency) ?? 0) + value.minor));
  }
  return [...totals.keys()].sort().map((currency) => money(currency, totals.get(currency)!));
}
