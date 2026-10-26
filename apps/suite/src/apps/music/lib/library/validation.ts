// AUTHORED-BY Codex GPT-6.1-Sol
import type { LibraryTrack } from "./types";

export type MusicLibraryErrorCode =
  | "invalid-track"
  | "duplicate-track"
  | "conflicting-album"
  | "invalid-name"
  | "invalid-options"
  | "invalid-duration"
  | "duration-overflow"
  | "invalid-play"
  | "duplicate-play"
  | "unknown-track"
  | "invalid-window";

/** Fail closed without echoing caller metadata into error messages. */
export class MusicLibraryError extends Error {
  constructor(public readonly code: MusicLibraryErrorCode) {
    super(`Music library: ${code}`);
    this.name = "MusicLibraryError";
  }
}

export function record(value: unknown, code: MusicLibraryErrorCode): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MusicLibraryError(code);
  }
}

export function text(value: unknown, code: MusicLibraryErrorCode): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value === "" ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new MusicLibraryError(code);
  }
}

export function duration(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new MusicLibraryError("invalid-duration");
  }
}

export function instant(value: unknown, code: MusicLibraryErrorCode): void {
  if (!Number.isSafeInteger(value) || Math.abs(value as number) > 8_640_000_000_000_000) {
    throw new MusicLibraryError(code);
  }
}

export function validateTracks(tracks: readonly LibraryTrack[]): void {
  if (!Array.isArray(tracks)) throw new MusicLibraryError("invalid-track");
  const ids = new Set<string>();
  for (const track of tracks) {
    record(track, "invalid-track");
    for (const value of [track.id, track.title, track.artist, track.albumId, track.albumTitle]) {
      text(value, "invalid-track");
    }
    if (track.albumArtist !== undefined) text(track.albumArtist, "invalid-track");
    for (const position of [track.discNumber, track.trackNumber]) {
      if (position !== undefined && (!Number.isSafeInteger(position) || position < 1)) {
        throw new MusicLibraryError("invalid-track");
      }
    }
    if (track.durationSeconds !== undefined) duration(track.durationSeconds);
    if (ids.has(track.id)) throw new MusicLibraryError("duplicate-track");
    ids.add(track.id);
  }
}

/** Locale-independent tie break, including distinct names that a collator equates. */
export function exactCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
