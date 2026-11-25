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
const MARKUP = ["<svg", "<html", "<script", "<!doctype", "<?xml"];

const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
]);

function isMp3Frame(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff) return false;
  const b1 = bytes[1] as number;
  const b2 = bytes[2] as number;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  return (b1 & 0xe0) === 0xe0 && version !== 1 && layer !== 0 && b2 >> 4 !== 15 && b2 >> 4 !== 0;
}

function magic(bytes: Uint8Array): Sniffed | undefined {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", extension: ".png" };
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
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
  if (startsWith(bytes, 4, "ftyp")) {
    const brand = latin1(bytes, 8, 12);
    if (brand === "avif" || brand === "avis")
      return { contentType: "image/avif", extension: ".avif" };
    if (MP4_BRANDS.has(brand)) return { contentType: "video/mp4", extension: ".mp4" };
    return undefined;
  }
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML: only the WebM doctype, never generic Matroska.
    return latin1(bytes, 0, 64).includes("webm")
      ? { contentType: "video/webm", extension: ".webm" }
      : undefined;
  }
  if (startsWith(bytes, 0, "glTF") && bytes.length >= 12 && bytes[4] === 2 && bytes[5] === 0) {
    return { contentType: "model/gltf-binary", extension: ".glb" };
  }
  if (startsWith(bytes, 0, "OggS")) return { contentType: "audio/ogg", extension: ".ogg" };
  if (startsWith(bytes, 0, "fLaC")) return { contentType: "audio/flac", extension: ".flac" };
  if (startsWith(bytes, 0, "ID3") || isMp3Frame(bytes)) {
    return { contentType: "audio/mpeg", extension: ".mp3" };
  }
  return undefined;
}

/**
 * Default sniffer: magic bytes against a short allowlist (PNG, JPEG, GIF, WebP, AVIF, MP4, WebM,
 * GLB, MP3, WAV, OGG, FLAC). It never returns SVG, HTML, XML or any script-capable type, and it
 * refuses a header that also carries markup in its first 64 bytes (a polyglot).
 */
export const defaultSniff: Sniffer = (bytes) => {
  const found = magic(bytes);
  if (found === undefined) return undefined;
  const head = latin1(bytes, 0, 64).toLowerCase();
  return MARKUP.some((marker) => head.includes(marker)) ? undefined : found;
};
