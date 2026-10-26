// AUTHORED-BY Codex GPT-6.1-Sol
export type ListErrorCode =
  | "invalid-entry"
  | "invalid-options"
  | "invalid-mime"
  | "invalid-filter"
  | "invalid-selection"
  | "invalid-action"
  | "unknown-id"
  | "invalid-move"
  | "unsupported-url";

/** Fail closed without copying resource addresses or names into errors. */
export class ListError extends Error {
  constructor(public readonly code: ListErrorCode) {
    super(`Drive list: ${code}`);
    this.name = "ListError";
  }
}

export function requireValid(condition: unknown, code: ListErrorCode): asserts condition {
  if (!condition) throw new ListError(code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isText(value: unknown): value is string {
  return typeof value === "string" && value.isWellFormed() && value.trim().length > 0;
}

export function validateIds(ids: readonly string[], code: ListErrorCode): void {
  requireValid(Array.isArray(ids), code);
  const seen = new Set<string>();
  for (const id of ids) {
    requireValid(isText(id) && !seen.has(id), code);
    seen.add(id);
  }
}
