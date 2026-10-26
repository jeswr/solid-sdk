// AUTHORED-BY Codex GPT-6.1-Sol
export type ReportsErrorCode =
  | "invalid-input"
  | "unsupported-currency"
  | "invalid-amount"
  | "overflow"
  | "currency-mismatch"
  | "invalid-rate"
  | "missing-rate"
  | "inexact-conversion"
  | "duplicate"
  | "invalid-date"
  | "invalid-period";

/** Codes only: financial inputs never appear in error messages. */
export class ReportsError extends Error {
  constructor(public readonly code: ReportsErrorCode) {
    super(`Money reports: ${code}`);
    this.name = "ReportsError";
  }
}

export function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ReportsError("invalid-input");
  }
}

export function list<T>(values: readonly T[]): void {
  if (!Array.isArray(values)) throw new ReportsError("invalid-input");
  for (let i = 0; i < values.length; i++) {
    if (!Object.hasOwn(values, i)) throw new ReportsError("invalid-input");
  }
}

export function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new ReportsError("invalid-input");
  }
}

export interface Period {
  readonly start: string;
  readonly end: string;
}

export function date(value: string): void {
  if (
    typeof value !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw new ReportsError("invalid-date");
  }
}

export function period(value: Period): void {
  record(value);
  date(value.start);
  date(value.end);
  if (value.start > value.end) throw new ReportsError("invalid-period");
}
