// AUTHORED-BY Claude Sonnet 5.5

/** What a sniffer decides about a byte string: the stored type and the file extension. */
export interface Sniffed {
  readonly contentType: string;
  /** Lowercase, with the leading dot, for example ".png". */
  readonly extension: string;
}

export type Sniffer = (bytes: Uint8Array) => Sniffed | undefined;

const startsWith = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

const startsWithBytes = (bytes: Uint8Array, values: readonly number[]): boolean =>
  bytes.length >= values.length && values.every((value, i) => bytes[i] === value);

const latin1 = (bytes: Uint8Array, start: number, end: number): string => {
  let text = "";
  for (let i = start; i < Math.min(end, bytes.length); i++)
    text += String.fromCharCode(bytes[i] as number);
  return text;
};

/** Markup that has no business in the first bytes of a media header (polyglot guard). */
const MARKUP = ["<svg", "<html", "<script", "<!doctype"];
/** How far into the bytes the polyglot guard looks. */
const SCAN = 512;
/** An XML prolog is only suspicious at the very start: photos carry XMP packets after it. */
const PROLOG_SCAN = 64;

const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "dash",
  "M4V ",
]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

const BITRATES: Readonly<Record<string, readonly number[]>> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Readonly<Record<number, readonly number[]>> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** Length in bytes of the MPEG audio frame whose header starts at `at`, if it is a valid one. */
function mpegFrameLength(bytes: Uint8Array, at: number): number | undefined {
  if (bytes.length < at + 4 || bytes[at] !== 0xff) return undefined;
  const b1 = bytes[at + 1] as number;
  const b2 = bytes[at + 2] as number;
  const version = (b1 >> 3) & 3;
  const layer = 4 - ((b1 >> 1) & 3);
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if ((b1 & 0xe0) !== 0xe0 || version === 1 || layer === 4 || bitrateIndex === 15) return undefined;
  if (bitrateIndex === 0 || rateIndex === 3) return undefined;
  const bitrate = (BITRATES[`${version === 3 ? 1 : 2}-${layer}`] as readonly number[])[
    bitrateIndex
  ] as number;
  const rate = (RATES[version] as readonly number[])[rateIndex] as number;
  const padding = (b2 >> 1) & 1;
  if (layer === 1) return (Math.floor((12 * bitrate * 1000) / rate) + padding) * 4;
  const factor = layer === 3 && version !== 3 ? 72 : 144;
  return Math.floor((factor * bitrate * 1000) / rate) + padding;
}

/** A valid ID3v2 header, or two consecutive MPEG frames (one sync pattern is far too weak). */
function isMp3(bytes: Uint8Array): boolean {
  if (startsWith(bytes, 0, "ID3")) {
    const header = bytes.subarray(3, 10);
    return (
      header.length === 7 &&
      (header[0] as number) < 0xff &&
      (header[1] as number) < 0xff &&
      ((header[2] as number) & 0x0f) === 0 &&
      header.subarray(3).every((byte) => byte < 0x80)
    );
  }
  const first = mpegFrameLength(bytes, 0);
  return first !== undefined && mpegFrameLength(bytes, first) !== undefined;
}

/** The brands a `ftyp` box lists, major brand first. */
function brandsOf(bytes: Uint8Array): string[] {
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const brands = [latin1(bytes, 8, 12)];
  for (let at = 16; at + 4 <= Math.min(size, 64, bytes.length); at += 4) {
    brands.push(latin1(bytes, at, at + 4));
  }
  return brands;
}

function isobmff(bytes: Uint8Array): Sniffed | undefined {
  const brands = brandsOf(bytes);
  const major = brands[0] as string;
  if (brands.includes("avif") || brands.includes("avis")) {
    return { contentType: "image/avif", extension: ".avif" };
  }
  if (["heic", "heix"].includes(major) || (HEIF_BRANDS.has(major) && brands.includes("heic"))) {
    return { contentType: "image/heic", extension: ".heic" };
  }
  if (major === "M4A ") return { contentType: "audio/mp4", extension: ".m4a" };
  if (major === "qt  ") return { contentType: "video/quicktime", extension: ".mov" };
  return MP4_BRANDS.has(major) ? { contentType: "video/mp4", extension: ".mp4" } : undefined;
}

/** The first Ogg packet names the codec; Ogg video and unknown codecs are not audio/ogg. */
const isOggAudio = (bytes: Uint8Array): boolean => {
  const head = latin1(bytes, 28, 64);
  return head.includes("vorbis") || head.includes("OpusHead");
};

function magic(bytes: Uint8Array): Sniffed | undefined {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", extension: ".png" };
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff]) && (bytes[3] ?? 0) >= 0xc0) {
    return { contentType: "image/jpeg", extension: ".jpg" };
  }
  if (startsWith(bytes, 0, "GIF87a") || startsWith(bytes, 0, "GIF89a")) {
    return { contentType: "image/gif", extension: ".gif" };
  }
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) {
    return { contentType: "image/webp", extension: ".webp" };
  }
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WAVE")) {
    return { contentType: "audio/wav", extension: ".wav" };
  }
  if (startsWith(bytes, 4, "ftyp") && bytes.length >= 12) return isobmff(bytes);
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML: only the WebM DocType element (0x4282, length 4, "webm"), never generic Matroska.
    const doctype = [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];
    const head = bytes.subarray(0, 64);
    for (let at = 4; at + doctype.length <= head.length; at++) {
      if (doctype.every((value, i) => head[at + i] === value)) {
        return { contentType: "video/webm", extension: ".webm" };
      }
    }
    return undefined;
  }
  if (startsWith(bytes, 0, "glTF") && bytes.length >= 12 && bytes[4] === 2 && bytes[5] === 0) {
    return { contentType: "model/gltf-binary", extension: ".glb" };
  }
  if (startsWith(bytes, 0, "OggS")) {
    return isOggAudio(bytes) ? { contentType: "audio/ogg", extension: ".ogg" } : undefined;
  }
  if (startsWith(bytes, 0, "fLaC")) return { contentType: "audio/flac", extension: ".flac" };
  return isMp3(bytes) ? { contentType: "audio/mpeg", extension: ".mp3" } : undefined;
}

/**
 * Default sniffer: magic bytes against a short allowlist (PNG, JPEG, GIF, WebP, AVIF, HEIC, MP4,
 * M4A, QuickTime, WebM, GLB, MP3, WAV, Ogg Vorbis/Opus, FLAC). It never returns SVG, HTML, XML
 * or any script-capable type, and it refuses bytes that carry markup in their first 512 bytes (an
 * XML prolog in the first 64), ignoring NULs so UTF-16 markup is seen too (a polyglot).
 */
export const defaultSniff: Sniffer = (bytes) => {
  const found = magic(bytes);
  if (found === undefined) return undefined;
  const head = latin1(bytes, 0, SCAN).replaceAll("\0", "").toLowerCase();
  const prolog = latin1(bytes, 0, PROLOG_SCAN).replaceAll("\0", "").toLowerCase();
  return MARKUP.some((marker) => head.includes(marker)) || prolog.includes("<?xml")
    ? undefined
    : found;
};
