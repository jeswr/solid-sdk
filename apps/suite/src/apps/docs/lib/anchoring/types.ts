// AUTHORED-BY Codex GPT-6.1-Sol

/** Unicode code point offsets in the caller's plain-text projection; end is exclusive. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface TextQuoteSelector {
  readonly type: "TextQuoteSelector";
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
}

export interface TextPositionSelector extends TextRange {
  readonly type: "TextPositionSelector";
}

export interface TextSelectors {
  readonly quote: TextQuoteSelector;
  readonly position: TextPositionSelector;
}

export interface ReanchorOptions {
  /** Minimum similarity, inclusive; default 0.5. Exact matches have confidence 1. */
  readonly threshold?: number;
  /** Fuzzy candidate start radius in code points: 0–4096, default 1024. */
  readonly searchRadius?: number;
  /** Maximum Levenshtein insertions/deletions/substitutions: 0–32, default 32. */
  readonly maxEdits?: number;
}

export type AnchorResult =
  | {
      readonly status: "anchored";
      readonly method: "position" | "quote" | "fuzzy";
      readonly range: TextRange;
      readonly confidence: number;
      /** Refreshed selectors for the next snapshot; the input selectors are never mutated. */
      readonly selectors: TextSelectors;
    }
  | {
      readonly status: "orphan";
      /** Best similarity found within the fuzzy bounds, or zero if no candidate exists. */
      readonly confidence: number;
    };
