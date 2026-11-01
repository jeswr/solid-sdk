// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

export type AlbumErrorCode =
  | "invalid-input"
  | "duplicate-member"
  | "invalid-order"
  | "member-not-found"
  | "invalid-position"
  | "invalid-metadata"
  | "invalid-predicate"
  | "invalid-selection";

/** Static messages deliberately exclude caller-supplied metadata and identifiers. */
export class AlbumError extends Error {
  constructor(public readonly code: AlbumErrorCode) {
    super(`Invalid album operation: ${code}`);
    this.name = "AlbumError";
  }
}

export function requireAlbum(condition: unknown, code: AlbumErrorCode): asserts condition {
  if (!condition) throw new AlbumError(code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** IDs are opaque, nonblank strings, preserved verbatim without URL normalisation. */
export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
