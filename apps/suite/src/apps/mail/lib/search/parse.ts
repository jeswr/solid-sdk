// AUTHORED-BY Codex GPT-6.1-Sol
import type { SearchClause, SearchQuery } from "./types";
import { forbiddenControl, makeTerm, SearchQueryError } from "./validation";

/** Grammar: query = conjunction (OR conjunction)*; conjunction = (-? term)*.
 * No recursion or implicit recovery; all source input must be consumed.
 */
export function parseQuery(query: string): SearchQuery {
  if (typeof query !== "string") throw new SearchQueryError("invalid-query", 0);
  const control = query.search(forbiddenControl);
  if (control !== -1) throw new SearchQueryError("unsupported-syntax", control);
  let position = 0;
  let terms: SearchClause[] = [];
  const clauses: { type: "and"; terms: SearchClause[] }[] = [{ type: "and", terms }];

  function skipSpace(): void {
    while (position < query.length && /\s/u.test(query.charAt(position))) position++;
  }

  function value(): string {
    const start = position;
    if (query[position] === '"') {
      position++;
      let text = "";
      while (position < query.length) {
        const char = query.charAt(position++);
        if (char === '"') return text;
        if (char === "\\") {
          const escaped = query[position++];
          if (escaped !== '"' && escaped !== "\\") {
            throw new SearchQueryError("invalid-escape", position - 2);
          }
          text += escaped;
        } else text += char;
      }
      throw new SearchQueryError("unterminated-quote", start);
    }
    while (position < query.length && !/\s/u.test(query.charAt(position))) {
      if (/[:"\\(){}[\]|*]/u.test(query.charAt(position))) {
        throw new SearchQueryError("unsupported-syntax", position);
      }
      position++;
    }
    const text = query.slice(start, position);
    if (/^(?:OR|AND|NOT)$/u.test(text) || /^[-+]/u.test(text)) {
      throw new SearchQueryError("unsupported-syntax", start);
    }
    return text;
  }

  skipSpace();
  while (position < query.length) {
    if (/^OR(?:\s|$)/u.test(query.slice(position))) {
      if (terms.length === 0) throw new SearchQueryError("missing-term", position);
      position += 2;
      skipSpace();
      if (position === query.length) throw new SearchQueryError("missing-term", position);
      terms = [];
      clauses.push({ type: "and", terms });
      continue;
    }
    const negated = query[position] === "-";
    if (negated) {
      position++;
      if (position === query.length || /\s/u.test(query.charAt(position))) {
        throw new SearchQueryError("missing-term", position);
      }
    }
    let field = "text";
    const prefix = /^[a-zA-Z]+:/u.exec(query.slice(position));
    if (prefix) {
      field = prefix[0].slice(0, -1);
      // `text:` is an AST field, never a source-language operator.
      if (field === "text") throw new SearchQueryError("unsupported-syntax", position);
      position += prefix[0].length;
      skipSpace();
    }
    const start = position;
    const term = makeTerm(field, value(), start);
    terms.push(negated ? { type: "not", term } : term);
    if (position < query.length && !/\s/u.test(query.charAt(position))) {
      throw new SearchQueryError("unsupported-syntax", position);
    }
    skipSpace();
  }
  return { type: "or", clauses };
}
