// AUTHORED-BY Codex GPT-6.1-Sol
export type LyricsErrorCode =
  | "invalid-input"
  | "limit-exceeded"
  | "invalid-lrc"
  | "invalid-timestamp"
  | "invalid-offset"
  | "invalid-document"
  | "invalid-position";

/** Fixed messages deliberately exclude the supplied lyrics. */
export class LyricsError extends Error {
  constructor(public readonly code: LyricsErrorCode) {
    super(`Lyrics: ${code}`);
    this.name = "LyricsError";
  }
}
