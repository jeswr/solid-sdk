// AUTHORED-BY Codex GPT-6.1-Sol
import type { MoneyTransaction } from "./types";

export type MoneyRulesErrorCode =
  | "invalid-input"
  | "invalid-date"
  | "invalid-amount"
  | "invalid-rule"
  | "unsupported-glob"
  | "ambiguous-transfer"
  | "scope-mismatch"
  | "overflow";

/** Messages contain codes only, never private transaction or rule values. */
export class MoneyRulesError extends Error {
  constructor(public readonly code: MoneyRulesErrorCode) {
    super(`Money rules: ${code}`);
    this.name = "MoneyRulesError";
  }
}

export function requireValue(
  condition: unknown,
  code: MoneyRulesErrorCode = "invalid-input",
): asserts condition {
  if (!condition) throw new MoneyRulesError(code);
}

export function record(
  value: unknown,
  keys: readonly string[],
  code: MoneyRulesErrorCode = "invalid-input",
): asserts value is Record<string, unknown> {
  requireValue(typeof value === "object" && value !== null && !Array.isArray(value), code);
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null, code);
  requireValue(
    Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key)),
    code,
  );
  // Reject accessors and hidden fields before reading or spreading a data record.
  requireValue(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => descriptor.enumerable && "value" in descriptor,
    ),
    code,
  );
}

export function identifier(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && value.trim().length > 0);
}

export function minorUnits(value: unknown): asserts value is number {
  requireValue(Number.isSafeInteger(value), "invalid-amount");
}

export function currency(value: unknown): asserts value is string {
  // Explicit uppercase codes only; no inference, conversion or ISO-code lookup.
  requireValue(typeof value === "string" && /^[A-Z]{3}$/.test(value));
}

export function dateDay(value: unknown): number {
  requireValue(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01",
    "invalid-date",
  );
  const time = Date.parse(`${value}T00:00:00.000Z`);
  requireValue(
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value,
    "invalid-date",
  );
  return time / 86_400_000;
}

export function transaction(value: unknown): asserts value is MoneyTransaction {
  record(value, [
    "id",
    "accountId",
    "date",
    "currency",
    "amount",
    "payee",
    "memo",
    "categoryId",
    "status",
  ]);
  identifier(value.id);
  identifier(value.accountId);
  dateDay(value.date);
  currency(value.currency);
  minorUnits(value.amount);
  requireValue(typeof value.payee === "string" && typeof value.memo === "string");
  if ("categoryId" in value) identifier(value.categoryId);
  requireValue(["uncleared", "cleared", "reconciled"].includes(value.status as string));
}

export function transactions(value: unknown): asserts value is readonly MoneyTransaction[] {
  requireValue(Array.isArray(value));
  const ids = new Set<string>();
  for (const item of value) {
    transaction(item);
    requireValue(!ids.has(item.id));
    ids.add(item.id);
  }
}

export function safeBalance(value: bigint): number {
  const result = Number(value);
  requireValue(Number.isSafeInteger(result), "overflow");
  return result;
}
