// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
export type SearchField = "from" | "in" | "before" | "after" | "on" | "has" | "is";

export type SearchTerm =
  | { readonly type: "word" | "phrase"; readonly value: string; readonly negated: boolean }
  | {
      readonly type: "filter";
      readonly field: SearchField;
      readonly value: string;
      readonly negated: boolean;
    };

/** Conjunction of positive terms and exclusions. */
export interface SearchQuery {
  readonly type: "query";
  readonly terms: readonly SearchTerm[];
}

export interface SearchMessage {
  readonly id: string;
  readonly roomId: string;
  readonly authorName: string;
  readonly authorWebId: string;
  readonly text: string;
  /** Integer Unix milliseconds in UTC years 0001–9999. */
  readonly createdAt: number;
  readonly hasAttachment: boolean;
  readonly inReplyTo: string | null;
}

/** Half-open UTF-16 offsets, relative to the displayed snippet including ellipses. */
export type MatchRange = readonly [start: number, end: number];

export interface SearchSnippet {
  readonly text: string;
  readonly ranges: readonly MatchRange[];
}

export interface SearchResult {
  readonly message: SearchMessage;
  readonly score: number;
  readonly snippet: SearchSnippet;
}
