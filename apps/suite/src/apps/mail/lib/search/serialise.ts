// AUTHORED-BY Codex GPT-6.1-Sol
import type { SearchClause, SearchQuery, SearchTerm } from "./types";
import { forbiddenControl, makeTerm, SearchQueryError } from "./validation";

function serialiseTerm(term: SearchTerm): string {
  if (
    term?.type !== "term" ||
    typeof term.value !== "string" ||
    forbiddenControl.test(term.value)
  ) {
    throw new SearchQueryError("invalid-ast", 0);
  }
  makeTerm(term.field, term.value, 0);
  // Always quote text so reserved words, punctuation and negation remain literal.
  const quoted = `"${term.value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
  return term.field === "text" ? quoted : `${term.field}:${quoted}`;
}

function serialiseClause(clause: SearchClause): string {
  if (!clause) throw new SearchQueryError("invalid-ast", 0);
  return clause.type === "not" ? `-${serialiseTerm(clause.term)}` : serialiseTerm(clause);
}

/** Canonical source form. Accepts only the representable OR-of-AND AST shape. */
export function serialiseQuery(ast: SearchQuery): string {
  if (ast?.type !== "or" || !Array.isArray(ast.clauses) || ast.clauses.length === 0) {
    throw new SearchQueryError("invalid-ast", 0);
  }
  return [...ast.clauses]
    .map((clause) => {
      if (
        clause?.type !== "and" ||
        !Array.isArray(clause.terms) ||
        (clause.terms.length === 0 && ast.clauses.length !== 1)
      ) {
        throw new SearchQueryError("invalid-ast", 0);
      }
      return [...clause.terms].map(serialiseClause).join(" ");
    })
    .join(" OR ");
}
