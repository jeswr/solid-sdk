// AUTHORED-BY Codex GPT-6.1-Sol
import type { ContactDate } from "./types";

export type ContactDatesErrorCode =
  | "invalid-date"
  | "invalid-contact"
  | "duplicate-contact"
  | "invalid-options"
  | "invalid-window";

/** Unsupported inputs fail as a whole; messages never echo personal data. */
export class ContactDatesError extends Error {
  constructor(public readonly code: ContactDatesErrorCode) {
    super(`Contact dates: ${code}`);
    this.name = "ContactDatesError";
  }
}

export function record(
  value: unknown,
  keys: readonly string[],
  code: ContactDatesErrorCode,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new ContactDatesError(code);
  }
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !keys.includes(key) ||
      !property ||
      !property.enumerable ||
      !("value" in property)
    ) {
      throw new ContactDatesError(code);
    }
  }
}

export function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function monthDays(year: number, month: number): number {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Strict proleptic Gregorian dates. No Date.parse, timezone conversion or normalization. */
export function parseContactDate(value: unknown): ContactDate {
  if (
    typeof value !== "string" ||
    ![7, 10].includes(value.length) ||
    !/^(?:\d{4}-|--)\d{2}-\d{2}$/.test(value)
  ) {
    throw new ContactDatesError("invalid-date");
  }
  const year = value.startsWith("--") ? undefined : Number(value.slice(0, 4));
  const month = Number(value.slice(-5, -3));
  const day = Number(value.slice(-2));
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > monthDays(year ?? 2000, month)) {
    throw new ContactDatesError("invalid-date");
  }
  return { ...(year === undefined ? {} : { year }), month, day };
}

export function fullDate(value: unknown): ContactDate & { year: number } {
  const date = parseContactDate(value);
  if (date.year === undefined) throw new ContactDatesError("invalid-date");
  return { ...date, year: date.year };
}

export function nonblank(value: unknown): value is string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters in contact projections.
  return typeof value === "string" && value.trim() !== "" && !/[\u0000-\u001f\u007f]/.test(value);
}
