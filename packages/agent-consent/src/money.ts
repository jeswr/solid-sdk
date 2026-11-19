// AUTHORED-BY Claude Opus 5.5
/**
 * Money as integer minor units (cents) with an ISO 4217 code. Amounts are never floats, so
 * a budget of $100.00 holds exactly five purchases of $20.00.
 */

export interface Money {
  /** Integer minor units (cents for USD). */
  readonly minor: number;
  /** ISO 4217 code, upper case. */
  readonly currency: string;
}

const CURRENCY = /^[A-Z]{3}$/;
/** Largest amount accepted anywhere in this package: one million major units. */
export const MAX_MINOR = 100_000_000;

/** True when `value` is a well-formed amount (non-negative safe integer, known shape). */
export function isMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.minor === "number" &&
    Number.isSafeInteger(m.minor) &&
    m.minor >= 0 &&
    m.minor <= MAX_MINOR &&
    typeof m.currency === "string" &&
    CURRENCY.test(m.currency)
  );
}

/** Build an amount from major units ("20" or 20.5); rejects more than two decimals. */
export function money(major: number | string, currency: string): Money {
  const text = typeof major === "number" ? String(major) : major.trim();
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new RangeError(`not an amount: ${text}`);
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  const out = { minor, currency };
  if (!isMoney(out)) throw new RangeError(`not an amount: ${text} ${currency}`);
  return out;
}

const SYMBOL: Readonly<Record<string, string>> = { USD: "$", GBP: "£", EUR: "€" };

/** "$20", "$20.50", "£1,250" — whole amounts drop the cents. */
export function formatMoney(m: Money): string {
  const major = Math.floor(m.minor / 100);
  const cents = m.minor % 100;
  const whole = major.toLocaleString("en-US");
  const body = cents === 0 ? whole : `${whole}.${String(cents).padStart(2, "0")}`;
  const symbol = SYMBOL[m.currency];
  return symbol ? `${symbol}${body}` : `${body} ${m.currency}`;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new RangeError("currency mismatch");
  return { minor: a.minor + b.minor, currency: a.currency };
}
