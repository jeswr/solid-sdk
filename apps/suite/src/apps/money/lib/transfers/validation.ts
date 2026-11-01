// AUTHORED-BY Codex GPT-6.1-Sol
import type { MoneyTransaction } from "./types";

export type TransfersErrorCode =
  | "invalid-input"
  | "invalid-date"
  | "invalid-amount"
  | "invalid-window"
  | "duplicate-id"
  | "unknown-account"
  | "invalid-split"
  | "split-total-mismatch";

/** Stable codes only: never includes private financial values in messages. */
export class TransfersError extends Error {
  constructor(public readonly code: TransfersErrorCode) {
    super(`Money transfers: ${code}`);
    this.name = "TransfersError";
  }
}

export function requireValue(
  condition: unknown,
  code: TransfersErrorCode = "invalid-input",
): asserts condition {
  if (!condition) throw new TransfersError(code);
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

/** Dense plain data arrays only; reject accessors before reading elements. */
export function list(value: unknown): asserts value is readonly unknown[] {
  requireValue(Array.isArray(value));
  requireValue(Object.getPrototypeOf(value) === Array.prototype);
  requireValue(
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === "string" &&
        (key === "length" || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length)),
    ),
  );
  requireValue(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => "value" in descriptor,
    ),
  );
  for (let index = 0; index < value.length; index++) {
    requireValue(Object.getOwnPropertyDescriptor(value, String(index))?.enumerable);
  }
}

export function identifier(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && value.length > 0 && value.trim() === value);
}

export function amount(value: unknown): asserts value is number {
  requireValue(Number.isSafeInteger(value), "invalid-amount");
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
  requireValue(typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency));
  amount(value.amount);
  requireValue(typeof value.payee === "string" && typeof value.memo === "string");
  if ("categoryId" in value) identifier(value.categoryId);
  requireValue(["uncleared", "cleared", "reconciled"].includes(value.status as string));
}
