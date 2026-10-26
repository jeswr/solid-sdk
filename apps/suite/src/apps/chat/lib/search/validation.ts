// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { SearchField, SearchQuery, SearchTerm } from "./types";

export const MAX_QUERY_LENGTH = 1_000;
export const MAX_QUERY_TERMS = 32;
export const MAX_MESSAGES = 100_000;
export const MAX_SNIPPET_LENGTH = 160;

export type SearchErrorCode =
  | "UNTERMINATED_PHRASE"
  | "INVALID_DATE"
  | "EMPTY_QUERY"
  | "QUERY_TOO_LARGE"
  | "TOO_MANY_MESSAGES"
  | "INVALID_QUERY"
  | "INVALID_MESSAGE"
  | "INVALID_TIME_ZONE";

/** Static text deliberately excludes caller data. */
export class SearchError extends Error {
  constructor(public readonly code: SearchErrorCode) {
    super(`Chat search: ${code}`);
    this.name = "SearchError";
  }
}

export function validText(value: unknown): value is string {
  return typeof value === "string" && value.isWellFormed();
}

export function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ς/g, "σ");
}

export function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith("0000")) {
    throw new SearchError("INVALID_DATE");
  }
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) {
    throw new SearchError("INVALID_DATE");
  }
}

export const FILTER_FIELDS: readonly SearchField[] = [
  "from",
  "in",
  "before",
  "after",
  "on",
  "has",
  "is",
];

export function validateTerm(term: SearchTerm): void {
  if (
    !term ||
    !validText(term.value) ||
    !fold(term.value).trim() ||
    typeof term.negated !== "boolean" ||
    !["word", "phrase", "filter"].includes(term.type)
  ) {
    throw new SearchError("INVALID_QUERY");
  }
  if (term.type !== "filter") return;
  if (!FILTER_FIELDS.includes(term.field)) throw new SearchError("INVALID_QUERY");
  if (term.field === "before" || term.field === "after" || term.field === "on") {
    validateDate(term.value);
  }
  if (
    (term.field === "has" && !["link", "attachment", "mention"].includes(term.value)) ||
    (term.field === "is" && term.value !== "thread")
  ) {
    throw new SearchError("INVALID_QUERY");
  }
}

/** Preflight lengths before folding, traversing terms, or evaluating messages. */
export function validateQuery(query: SearchQuery): void {
  if (query?.type !== "query" || !Array.isArray(query.terms)) {
    throw new SearchError("INVALID_QUERY");
  }
  if (query.terms.length > MAX_QUERY_TERMS) throw new SearchError("QUERY_TOO_LARGE");
  let length = 0;
  for (const term of query.terms) {
    if (!term || typeof term.value !== "string") throw new SearchError("INVALID_QUERY");
    length += term.value.length;
    if (length > MAX_QUERY_LENGTH) throw new SearchError("QUERY_TOO_LARGE");
  }
  for (const term of query.terms) validateTerm(term);
  if (!query.terms.some((term) => !term.negated)) throw new SearchError("EMPTY_QUERY");
}
