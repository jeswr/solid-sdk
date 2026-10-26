// AUTHORED-BY Codex GPT-6.1-Sol
import { serialiseQuery } from "./serialise";
import type { MessageSummary, SearchQuery, SearchTerm } from "./types";
import { dateBoundary, SearchQueryError } from "./validation";

function validateMessage(message: MessageSummary): void {
  if (
    !message ||
    typeof message.from !== "string" ||
    !Array.isArray(message.to) ||
    ![...message.to].every((recipient) => typeof recipient === "string") ||
    typeof message.subject !== "string" ||
    typeof message.snippet !== "string" ||
    typeof message.hasAttachment !== "boolean" ||
    typeof message.unread !== "boolean" ||
    !Number.isSafeInteger(message.dateSent) ||
    message.dateSent < -62_135_596_800_000 ||
    message.dateSent > 253_402_300_799_999
  ) {
    throw new SearchQueryError("invalid-message", 0);
  }
}

function matches(term: SearchTerm, message: MessageSummary): boolean {
  const includes = (text: string): boolean => text.toLowerCase().includes(term.value.toLowerCase());
  switch (term.field) {
    case "text":
      return [message.from, ...message.to, message.subject, message.snippet].some(includes);
    case "from":
      return includes(message.from);
    case "to":
      return message.to.some(includes);
    case "subject":
      return includes(message.subject);
    case "has":
      return message.hasAttachment;
    case "is":
      return message.unread;
    case "before":
      return message.dateSent < dateBoundary(term.value, 0);
    case "after":
      return message.dateSent > dateBoundary(term.value, 0);
  }
}

/** Validate the entire AST and summary before short-circuiting boolean evaluation. */
export function evaluateQuery(ast: SearchQuery, message: MessageSummary): boolean {
  serialiseQuery(ast);
  validateMessage(message);
  return ast.clauses.some((clause) =>
    clause.terms.every((term) =>
      term.type === "not" ? !matches(term.term, message) : matches(term, message),
    ),
  );
}
