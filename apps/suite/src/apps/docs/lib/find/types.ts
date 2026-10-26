// AUTHORED-BY Codex GPT-6.1-Sol
export type { DocumentMark, DocumentNode } from "../diff/types";

import type { DocumentNode } from "../diff/types";

export type FindErrorCode =
  | "invalid-document"
  | "invalid-options"
  | "invalid-query"
  | "invalid-replacement"
  | "unsupported-regex"
  | "step-budget-exceeded"
  | "invalid-match-index"
  | "stale-document";

export class FindError extends Error {
  readonly name = "FindError";
  constructor(
    readonly code: FindErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface FindOptions {
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly regex?: boolean;
  /** Shared across all runs and candidate starts; positive integer, at most 10 million. */
  readonly stepBudget?: number;
}

/** Absolute PM UTF-16 positions; `to` is exclusive. */
export interface FindMatch {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface UndoableChangeSet {
  /** Ranges refer to the original document, in ascending order. */
  readonly matches: readonly FindMatch[];
  apply(document: unknown): DocumentNode;
  undo(document: unknown): DocumentNode;
}

export interface ReplaceResult {
  readonly document: DocumentNode;
  readonly changeSet: UndoableChangeSet;
}
