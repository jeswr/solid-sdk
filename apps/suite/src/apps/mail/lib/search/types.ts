// AUTHORED-BY Codex GPT-6.1-Sol
export type SearchField = "text" | "from" | "to" | "subject" | "has" | "is" | "before" | "after";

export interface SearchTerm {
  readonly type: "term";
  readonly field: SearchField;
  readonly value: string;
}

export type SearchClause = SearchTerm | { readonly type: "not"; readonly term: SearchTerm };

/** Canonical OR of AND groups; a sole empty AND represents an empty query. */
export interface SearchQuery {
  readonly type: "or";
  readonly clauses: readonly {
    readonly type: "and";
    readonly terms: readonly SearchClause[];
  }[];
}

/** Text supplied by the data layer; no RDF, address resolution or body loading. */
export interface MessageSummary {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly snippet: string;
  readonly hasAttachment: boolean;
  readonly unread: boolean;
  /** Integer Unix milliseconds in UTC years 0001–9999. */
  readonly dateSent: number;
}
