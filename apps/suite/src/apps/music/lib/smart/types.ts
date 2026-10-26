// AUTHORED-BY Codex GPT-6.1-Sol
import type { LibraryTrack } from "../library";

/** Explicit adapter metadata; absent values are unknown, never zero or a guessed date. */
export interface SmartPlaylistTrack extends LibraryTrack {
  readonly genre?: string;
  readonly year?: number;
  readonly playCount?: number;
  /** Integer epoch milliseconds within the JavaScript Date range. */
  readonly lastPlayedAt?: number;
  /** Finite 0–5, including fractional ratings. */
  readonly rating?: number;
}

export type TextField = "artist" | "album" | "genre";
export type NumberField = "year" | "playCount" | "lastPlayedAt" | "rating";
export type TextOperator = "eq" | "ne" | "contains" | "startsWith" | "endsWith";
export type NumberOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte";
export type SmartPlaylistRule =
  | { readonly field: TextField; readonly operator: TextOperator; readonly value: string }
  | { readonly field: NumberField; readonly operator: NumberOperator; readonly value: number };

export interface SmartPlaylistSort {
  readonly field: TextField | NumberField | "title";
  readonly direction: "asc" | "desc";
}

/** Versioned JSON data, with no implicit defaults or nested groups. */
export interface SmartPlaylist {
  readonly version: 1;
  readonly mode: "all" | "any";
  readonly rules: readonly SmartPlaylistRule[];
  readonly sort?: SmartPlaylistSort;
  readonly limit?: number;
}
