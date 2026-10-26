// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
export type MusicQueueErrorCode =
  | "invalid-queue"
  | "invalid-action"
  | "invalid-entry"
  | "invalid-url"
  | "invalid-playlist"
  | "unsupported-playlist";

/** Messages are fixed and never echo playlist content or URLs. */
export class MusicQueueError extends Error {
  constructor(public readonly code: MusicQueueErrorCode) {
    super(`Music queue: ${code}`);
    this.name = "MusicQueueError";
  }
}
