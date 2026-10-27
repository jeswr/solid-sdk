// AUTHORED-BY Codex GPT-6.1-Sol
export type ActivityErrorCode =
  | "invalid-events"
  | "invalid-event"
  | "invalid-url"
  | "invalid-time"
  | "conflicting-event"
  | "inconsistent-history"
  | "invalid-limit"
  | "invalid-stars"
  | "invalid-time-zone";

/** Error messages never include supplied resource addresses or actor identifiers. */
export class ActivityError extends Error {
  constructor(public readonly code: ActivityErrorCode) {
    super(`Drive activity: ${code}`);
    this.name = "ActivityError";
  }
}

export function requireValid(condition: unknown, code: ActivityErrorCode): asserts condition {
  if (!condition) throw new ActivityError(code);
}

export function isText(value: unknown): value is string {
  return typeof value === "string" && value.isWellFormed() && value.trim().length > 0;
}

export function validateUrl(value: unknown, actor = false): asserts value is string {
  requireValid(isText(value), "invalid-url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ActivityError("invalid-url");
  }
  requireValid(
    (url.protocol === "https:" || url.protocol === "http:") &&
      url.href === value &&
      !url.username &&
      !url.password &&
      (actor || !value.includes("#")),
    "invalid-url",
  );
}

export function validateTime(value: unknown): asserts value is number {
  requireValid(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 253402300799999,
    "invalid-time",
  );
}
