// AUTHORED-BY Codex GPT-6.1-Sol
import { parseBuffer } from "music-metadata";

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
  const { common, format } = await parseBuffer(new Uint8Array(buffer), undefined, {
    duration: true,
  });
  return {
    title: common.title ?? null,
    artist: common.artist ?? null,
    album: common.album ?? null,
    track: common.track.no,
    disc: common.disk.no,
    year: common.year ?? null,
    duration: format.duration ?? null,
    coverArtMime: common.picture?.[0]?.format ?? null,
  };
}
