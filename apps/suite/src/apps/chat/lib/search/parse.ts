// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { SearchField, SearchQuery, SearchTerm } from "./types";
import {
  FILTER_FIELDS,
  MAX_QUERY_LENGTH,
  MAX_QUERY_TERMS,
  SearchError,
  validateQuery,
  validText,
} from "./validation";

/** Length checks precede all scanning; stop tokenising immediately at term 33. */
export function parseQuery(source: string): SearchQuery {
  if (typeof source !== "string") throw new SearchError("INVALID_QUERY");
  if (source.length > MAX_QUERY_LENGTH) throw new SearchError("QUERY_TOO_LARGE");
  if (!validText(source) || /\p{Cc}/u.test(source.replace(/[\t\r\n]/g, ""))) {
    throw new SearchError("INVALID_QUERY");
  }
  const tokens: string[] = [];
  let position = 0;
  while (position < source.length) {
    if (/\s/u.test(source.charAt(position))) {
      position++;
      continue;
    }
    if (tokens.length === MAX_QUERY_TERMS) throw new SearchError("QUERY_TOO_LARGE");
    const start = position;
    let quoted = false;
    while (position < source.length) {
      const character = source.charAt(position);
      if (character === '"') quoted = !quoted;
      if (!quoted && /\s/u.test(character)) break;
      position++;
    }
    if (quoted) throw new SearchError("UNTERMINATED_PHRASE");
    tokens.push(source.slice(start, position));
  }
  const terms: SearchTerm[] = tokens.map((token) => {
    const negated = token.startsWith("-");
    const body = negated ? token.slice(1) : token;
    const prefix = /^([a-zA-Z][a-zA-Z0-9_-]*):/u.exec(body);
    const key = prefix?.[1];
    const raw = prefix ? body.slice(prefix[0].length) : body;
    const phrase = raw.startsWith('"');
    const value = phrase ? raw.slice(1, -1) : raw;
    if (
      (phrase && !raw.endsWith('"')) ||
      value.includes('"') ||
      value.includes("\\") ||
      (!phrase && value.startsWith("-"))
    ) {
      throw new SearchError("INVALID_QUERY");
    }
    if (key && FILTER_FIELDS.includes(key as SearchField)) {
      return { type: "filter", field: key as SearchField, value, negated };
    }
    // Unknown keys remain literal text, including their colon.
    return {
      type: phrase ? "phrase" : "word",
      value: prefix ? `${prefix[0]}${value}` : value,
      negated,
    };
  });
  const query: SearchQuery = { type: "query", terms };
  validateQuery(query);
  return query;
}
