// AUTHORED-BY Codex GPT-6.1-Sol
export type BudgetErrorCode =
  | "invalid-input"
  | "unsupported-currency"
  | "invalid-amount"
  | "currency-mismatch"
  | "overflow"
  | "invalid-date"
  | "invalid-period"
  | "duplicate"
  | "invalid-category-tree"
  | "nonconsecutive-months"
  | "missing-balance";

/** Messages contain codes only, never financial input values. */
export class BudgetError extends Error {
  constructor(public readonly code: BudgetErrorCode) {
    super(`Money budget: ${code}`);
    this.name = "BudgetError";
  }
}

export function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BudgetError("invalid-input");
  }
}

export function list<T>(value: readonly T[]): void {
  if (!Array.isArray(value)) throw new BudgetError("invalid-input");
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i)) throw new BudgetError("invalid-input");
  }
}

export function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new BudgetError("invalid-input");
  }
}

export function integer(value: number): number {
  if (!Number.isSafeInteger(value)) throw new BudgetError("invalid-amount");
  return value === 0 ? 0 : value;
}

export function checked(value: number): number {
  if (!Number.isSafeInteger(value)) throw new BudgetError("overflow");
  return value === 0 ? 0 : value;
}

export function date(value: string): void {
  if (
    typeof value !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw new BudgetError("invalid-date");
  }
}

export function month(value: string): void {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new BudgetError("invalid-date");
  }
}

export interface Period {
  readonly start: string;
  readonly end: string;
}

export function period(value: Period): void {
  record(value);
  date(value.start);
  date(value.end);
  if (value.start > value.end) throw new BudgetError("invalid-period");
}

export function within(value: string, range: Period): boolean {
  return value >= range.start && value <= range.end;
}
