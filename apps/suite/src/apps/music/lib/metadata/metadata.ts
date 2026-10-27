// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type IAudioMetadata, parseBuffer, UnexpectedFileContentError } from "music-metadata";

// Match the pinned parser's default and share it with our normalization buffer.
const maxMemoryAllocation = 64 * 1024 * 1024;

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
 * Unsynchronised ID3v2.3 extended headers are unsupported and reject with
 * UnexpectedFileContentError rather than risk returning misaligned metadata.
 * Raw unsynchronised tags and their complete reconstruction buffer are limited
 * to 64 MiB; exceeding either limit rejects with UnexpectedFileContentError.
 * Uses music-metadata's browser-compatible Uint8Array API (no File or I/O).
 */
export async function extractAudioMetadata(buffer: ArrayBuffer): Promise<AudioMetadata> {
  const { common, format, native } = await parseBuffer(
    normalizeId3v23(new Uint8Array(buffer)),
    undefined,
    {
      duration: true,
      maxMemoryAllocation,
    },
  );
  return {
    title: common.title ?? null,
    artist: common.artists?.[0] ?? common.artist ?? null,
    album: common.album ?? null,
    track: id3Number(native, ["TRCK"]) ?? common.track.no,
    disc: common.disk.no,
    year:
      id3Number(native, ["TDRC", "TYER"]) ??
      (Number.isFinite(common.year) ? common.year : null) ??
      id3Number(native, ["year"], ["ID3v1"]),
    duration: format.duration ?? null,
    coverArtMime: common.picture?.find((picture) => picture.format !== "-->")?.format ?? null,
  };
}

// ID3v2.3 section 5 applies unsynchronisation to the entire tag body, including
// frame headers. Frame sizes describe decoded bytes; the tag size describes
// encoded bytes. Normalize leading tags before the pinned parser sees them.
function normalizeId3v23(bytes: Uint8Array): Uint8Array {
  let normalized: Uint8Array | undefined;
  let position = 0;
  let offset = 0;
  while (
    offset + 10 <= bytes.length &&
    bytes[offset] === 0x49 &&
    bytes[offset + 1] === 0x44 &&
    bytes[offset + 2] === 0x33
  ) {
    const header = bytes.subarray(offset, offset + 10);
    const sizeBytes = header.subarray(6, 10);
    const size = sizeBytes.reduce((value, byte) => value * 128 + byte, 0);
    const end = offset + 10 + size;
    if (header[3] === 3 && ((header[5] as number) & 0x80) !== 0) {
      if (sizeBytes.some((byte) => byte > 127) || end > bytes.length) {
        throw new UnexpectedFileContentError("ID3v2.3", "Invalid unsynchronised tag size");
      }
      if (((header[5] as number) & 0x40) !== 0) {
        throw new UnexpectedFileContentError(
          "ID3v2.3",
          "Unsynchronised extended headers are unsupported",
        );
      }
      // Validate raw sizes before scanning the body, even if decoding would
      // shrink it below the parser's limit. Include audio and all leading tags
      // in the reconstruction bound; allocate once, without per-tag buffers.
      if (size > maxMemoryAllocation || bytes.length > maxMemoryAllocation) {
        throw new UnexpectedFileContentError("ID3v2.3", "Normalization exceeds allocation limit");
      }
      if (!normalized) {
        normalized = new Uint8Array(bytes.length);
        normalized.set(bytes.subarray(0, offset));
        position = offset;
      }
      const start = position;
      normalized.set(header, position);
      position += 10;
      for (let read = offset + 10; read < end; read++) {
        const byte = bytes[read] as number;
        normalized[position++] = byte;
        // Remove exactly one escape zero, bounded by this tag's encoded body.
        if (byte === 0xff && read + 1 < end && bytes[read + 1] === 0) read++;
      }
      normalized[start + 5] = (normalized[start + 5] as number) & ~0x80;
      let decodedSize = position - start - 10;
      for (let i = 9; i >= 6; i--) {
        normalized[start + i] = decodedSize & 127;
        decodedSize >>>= 7;
      }
    } else if (normalized) {
      const tag = bytes.subarray(offset, end);
      normalized.set(tag, position);
      position += tag.length;
    }
    offset = end;
  }
  if (!normalized) return bytes;
  const tail = bytes.subarray(offset);
  normalized.set(tail, position);
  return normalized.subarray(0, position + tail.length);
}

// The parser's common track and derived year can be overwritten by ID3v1.
// Resolve these from native tags first, matching its ID3v2 source priority.
function id3Number(
  native: IAudioMetadata["native"],
  ids: readonly string[],
  sources: readonly string[] = ["ID3v2.4", "ID3v2.3"],
): number | null {
  for (const source of sources) {
    for (const id of ids) {
      const value = native[source]?.findLast((tag) => tag.id === id)?.value;
      if (typeof value !== "string") continue;
      const number = Number.parseInt(value, 10);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}
