// AUTHORED-BY Codex GPT-6.1-Sol
import type { SearchField, SearchTerm } from "./types";

export type SearchQueryErrorCode =
  | "invalid-query"
  | "unsupported-syntax"
  | "missing-term"
  | "missing-value"
  | "unterminated-quote"
  | "invalid-escape"
  | "invalid-date"
  | "invalid-ast"
  | "invalid-message";

/** Position is a zero-based UTF-16 offset (end-of-input is query.length).
 * Non-source inputs (AST/message) use position 0. Error text never echoes input.
 */
export class SearchQueryError extends Error {
  constructor(
    public readonly code: SearchQueryErrorCode,
    public readonly position: number,
  ) {
    super(`Mail search: ${code} at ${position}`);
    this.name = "SearchQueryError";
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: explicitly reject unsupported controls
export const forbiddenControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

/** Strict Gregorian validation, including leap centuries and years below 100. */
export function dateBoundary(value: string, position: number): number {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith("0000")) {
    throw new SearchQueryError("invalid-date", position);
  }
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) {
    throw new SearchQueryError("invalid-date", position);
  }
  return instant;
}

export function makeTerm(field: string, value: string, position: number): SearchTerm {
  if (!["text", "from", "to", "subject", "has", "is", "before", "after"].includes(field)) {
    throw new SearchQueryError("unsupported-syntax", position);
  }
  if (value.trim() === "") throw new SearchQueryError("missing-value", position);
  if ((field === "has" && value !== "attachment") || (field === "is" && value !== "unread")) {
    throw new SearchQueryError("unsupported-syntax", position);
  }
  if (field === "before" || field === "after") dateBoundary(value, position);
  return { type: "term", field: field as SearchField, value };
}
