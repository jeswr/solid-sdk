// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
export { evaluateQuery, searchMessages } from "./evaluate";
export { parseQuery } from "./parse";
export type {
  MatchRange,
  SearchField,
  SearchMessage,
  SearchQuery,
  SearchResult,
  SearchSnippet,
  SearchTerm,
} from "./types";
export {
  MAX_MESSAGES,
  MAX_QUERY_LENGTH,
  MAX_QUERY_TERMS,
  MAX_SNIPPET_LENGTH,
  SearchError,
  type SearchErrorCode,
} from "./validation";
