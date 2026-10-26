// AUTHORED-BY Codex GPT-6.1-Sol
import type { DateRange, ForecastTransaction, RecurringTemplate } from "./types";

export type ForecastErrorCode =
  | "invalid-input"
  | "invalid-date"
  | "invalid-range"
  | "invalid-amount"
  | "invalid-recurrence"
  | "duplicate-id"
  | "unknown-account"
  | "currency-mismatch"
  | "overflow";

/** Error messages never contain private financial input values. */
export class ForecastError extends Error {
  constructor(public readonly code: ForecastErrorCode) {
    super(`Money forecast: ${code}`);
    this.name = "ForecastError";
  }
}

export function requireValue(
  condition: unknown,
  code: ForecastErrorCode = "invalid-input",
): asserts condition {
  if (!condition) throw new ForecastError(code);
}

export function record(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  requireValue(typeof value === "object" && value !== null && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null);
  requireValue(
    Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key)),
  );
  requireValue(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => descriptor.enumerable && "value" in descriptor,
    ),
  );
}

export function list(value: unknown): asserts value is readonly unknown[] {
  requireValue(Array.isArray(value));
  requireValue(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => "value" in descriptor,
    ),
  );
  for (let i = 0; i < value.length; i++) requireValue(Object.hasOwn(value, i));
}

export function identifier(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && value.length > 0 && value.trim() === value);
}

export function currency(value: unknown): asserts value is string {
  // Explicit code, no ISO lookup, inferred precision or conversion is needed.
  requireValue(typeof value === "string" && /^[A-Z]{3}$/.test(value));
}

export function amount(value: unknown): asserts value is number {
  requireValue(Number.isSafeInteger(value), "invalid-amount");
}

export function checked(value: bigint): number {
  const result = Number(value);
  requireValue(Number.isSafeInteger(result), "overflow");
  return result;
}

export function dateDay(value: unknown): number {
  requireValue(
    typeof value === "string" && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value),
    "invalid-date",
  );
  const time = Date.parse(`${value}T00:00:00.000Z`);
  requireValue(
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value,
    "invalid-date",
  );
  return time / 86_400_000;
}

export function dateString(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function range(value: DateRange): void {
  record(value, ["start", "end"]);
  requireValue(dateDay(value.start) <= dateDay(value.end), "invalid-range");
}

export function template(value: unknown): asserts value is RecurringTemplate {
  record(value, [
    "id",
    "accountId",
    "currency",
    "payee",
    "amount",
    "startDate",
    "endDate",
    "recurrence",
  ]);
  identifier(value.id);
  identifier(value.accountId);
  identifier(value.payee);
  currency(value.currency);
  amount(value.amount);
  const start = dateDay(value.startDate);
  if ("endDate" in value) requireValue(dateDay(value.endDate) >= start, "invalid-range");
  record(value.recurrence, ["frequency", "day"]);
  const rule = value.recurrence;
  if (rule.frequency === "monthly") {
    requireValue(
      rule.day === "last" ||
        (Number.isInteger(rule.day) && Number(rule.day) >= 1 && Number(rule.day) <= 31),
      "invalid-recurrence",
    );
  } else {
    requireValue(
      ["weekly", "biweekly", "yearly"].includes(rule.frequency as string) && !("day" in rule),
      "invalid-recurrence",
    );
  }
}

export function transaction(value: unknown): asserts value is ForecastTransaction {
  record(value, ["id", "accountId", "currency", "payee", "amount", "date"]);
  identifier(value.id);
  identifier(value.accountId);
  identifier(value.payee);
  currency(value.currency);
  amount(value.amount);
  dateDay(value.date);
}

export function unique<T extends { readonly id: string }>(
  values: readonly T[],
  validate: (value: unknown) => void,
): void {
  list(values);
  const ids = new Set<string>();
  for (const value of values) {
    validate(value);
    requireValue(!ids.has(value.id), "duplicate-id");
    ids.add(value.id);
  }
}
