// AUTHORED-BY Codex GPT-6.1-Sol

export type RecurrenceErrorCode =
  | "invalid-input"
  | "invalid-date"
  | "invalid-zone"
  | "invalid-rule"
  | "unsupported-rule"
  | "start-mismatch"
  | "nonexistent-time"
  | "limit-exceeded";

/** Messages deliberately omit untrusted calendar contents. */
export class RecurrenceError extends Error {
  constructor(public readonly code: RecurrenceErrorCode) {
    super(`Calendar recurrence: ${code}`);
    this.name = "RecurrenceError";
  }
}

export function check(condition: unknown, code: RecurrenceErrorCode): asserts condition {
  if (!condition) throw new RecurrenceError(code);
}

export function fields(value: unknown, allowed: readonly string[]): void {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "invalid-input");
  check(
    Object.keys(value).every((key) => allowed.includes(key)),
    "invalid-input",
  );
}
