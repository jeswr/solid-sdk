// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type IAudioMetadata, parseBuffer } from "music-metadata";

/** Missing fields are null; track and disc are their numbers, without totals. */
export interface AudioMetadata {
  readonly title: string | null;
  /** The first artist supplied by the file's tags. */
  readonly artist: string | null;
  readonly album: string | null;
  readonly track: number | null;
  readonly disc: number | null;
  readonly year: number | null;
  /** Seconds, including fractional seconds, when the container supplies a duration. */
  readonly duration: number | null;
  /** MIME type of the first embedded picture; image bytes are not returned. */
  readonly coverArtMime: string | null;
}

/**
 * Read ID3v2.3/2.4, ID3v1, FLAC/Ogg Vorbis and MP4 metadata entirely in memory.
 * ID3v2 takes precedence over ID3v1. Missing metadata stays null rather than
 * being inferred from a filename. Unsupported or unreadable input rejects with
 * the parser's error; recoverable damage may yield partial metadata.
 * Uses music-metadata's browser-compatible Uint8Array API (no File or I/O).
 */
export async function extractAudioMetadata(buffer: ArrayBuffer): Promise<AudioMetadata> {
  const { common, format, native } = await parseBuffer(new Uint8Array(buffer), undefined, {
    duration: true,
  });
  return {
    title: common.title ?? null,
    artist: common.artist ?? null,
    album: common.album ?? null,
    track: id3Number(native, ["TRCK"]) ?? common.track.no,
    disc: common.disk.no,
    year: id3Number(native, ["TDRC", "TYER"]) ?? common.year ?? null,
    duration: format.duration ?? null,
    coverArtMime: common.picture?.[0]?.format ?? null,
  };
}

// The parser's common track and derived year can be overwritten by ID3v1.
// Resolve these from native tags first, matching its ID3v2 source priority.
function id3Number(native: IAudioMetadata["native"], ids: readonly string[]): number | null {
  for (const source of ["ID3v2.4", "ID3v2.3"]) {
    for (const id of ids) {
      const value = native[source]?.findLast((tag) => tag.id === id)?.value;
      if (typeof value !== "string") continue;
      const number = Number.parseInt(value, 10);
      if (!Number.isNaN(number)) return number;
    }
  }
  return null;
}
