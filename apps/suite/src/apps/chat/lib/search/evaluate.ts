// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type FoldedText, findMatches, hasLink, hasMention, project } from "./match";
import { parseQuery } from "./parse";
import { makeSnippet } from "./snippet";
import type { MatchRange, SearchMessage, SearchQuery, SearchResult, SearchTerm } from "./types";
import { fold, MAX_MESSAGES, SearchError, validateQuery, validText } from "./validation";

function checkMessages(messages: readonly SearchMessage[]): void {
  if (!Array.isArray(messages)) throw new SearchError("INVALID_MESSAGE");
  if (messages.length > MAX_MESSAGES) throw new SearchError("TOO_MANY_MESSAGES");
}

function nonblank(value: unknown): boolean {
  return validText(value) && value.trim() !== "";
}

function validateMessage(message: SearchMessage, ids: Set<string>): void {
  if (
    !message ||
    !nonblank(message.id) ||
    !nonblank(message.roomId) ||
    !validText(message.authorName) ||
    !nonblank(message.authorWebId) ||
    !validText(message.text) ||
    !Number.isSafeInteger(message.createdAt) ||
    message.createdAt < -62_135_596_800_000 ||
    message.createdAt > 253_402_300_799_999 ||
    typeof message.hasAttachment !== "boolean" ||
    (message.inReplyTo !== null && !nonblank(message.inReplyTo)) ||
    ids.has(message.id)
  ) {
    throw new SearchError("INVALID_MESSAGE");
  }
  ids.add(message.id);
}

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  if (typeof timeZone !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/u.test(timeZone)) {
    throw new SearchError("INVALID_TIME_ZONE");
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new SearchError("INVALID_TIME_ZONE");
  }
}

/** Numeric local date keys also handle UTC boundary instants falling in local year 0/10000. */
function localDate(instant: number, formatter: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  const year = parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year);
  return year * 10_000 + Number(parts.month) * 100 + Number(parts.day);
}

function filterMatches(
  term: Extract<SearchTerm, { type: "filter" }>,
  message: SearchMessage,
  day: number,
): boolean {
  switch (term.field) {
    case "from":
      return /^https?:\/\//iu.test(term.value)
        ? message.authorWebId === term.value
        : findMatches(project(message.authorName), fold(term.value), false).length > 0;
    case "in":
      return message.roomId === term.value;
    case "before":
      return day < Number(term.value.replaceAll("-", ""));
    case "after":
      return day > Number(term.value.replaceAll("-", ""));
    case "on":
      return day === Number(term.value.replaceAll("-", ""));
    case "has":
      if (term.value === "attachment") return message.hasAttachment;
      if (term.value === "mention") return hasMention(message.text);
      return hasLink(message.text);
    case "is":
      return message.inReplyTo !== null;
  }
}

function matchMessage(
  query: SearchQuery,
  message: SearchMessage,
  formatter: Intl.DateTimeFormat,
): SearchResult | null {
  let content: FoldedText | undefined;
  let score = 0;
  const ranges: MatchRange[] = [];
  for (const term of query.terms) {
    let matches: boolean;
    if (term.type === "filter")
      matches = filterMatches(term, message, localDate(message.createdAt, formatter));
    else {
      content ??= project(message.text);
      const found = findMatches(content, fold(term.value), term.type === "phrase");
      matches = found.length > 0;
      if (!term.negated) for (const range of found) ranges.push(range);
    }
    if (term.negated ? matches : !matches) return null;
    if (!term.negated) score++;
  }
  return { message, score, snippet: makeSnippet(message.text, ranges) };
}

/** Validate untrusted ASTs and the whole snapshot; never mutate the caller's records. */
export function evaluateQuery(
  query: SearchQuery,
  messages: readonly SearchMessage[],
  timeZone: string,
): SearchResult[] {
  checkMessages(messages);
  validateQuery(query);
  const formatter = dateFormatter(timeZone);
  const ids = new Set<string>();
  const results: SearchResult[] = [];
  for (const message of messages) {
    validateMessage(message, ids);
    const result = matchMessage(query, message, formatter);
    if (result) results.push(result);
  }
  return results.sort(compareResults);
}

/** Shared ordering contract; snapshot validation guarantees unique IDs. */
export function compareResults(a: SearchResult, b: SearchResult): number {
  return (
    b.score - a.score ||
    b.message.createdAt - a.message.createdAt ||
    (a.message.id < b.message.id ? -1 : Number(a.message.id > b.message.id))
  );
}

/** Convenience entry point; message count is checked before parsing any query text. */
export function searchMessages(
  source: string,
  messages: readonly SearchMessage[],
  timeZone: string,
): SearchResult[] {
  checkMessages(messages);
  return evaluateQuery(parseQuery(source), messages, timeZone);
}
