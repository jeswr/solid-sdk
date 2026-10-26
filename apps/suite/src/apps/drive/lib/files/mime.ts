// AUTHORED-BY Codex GPT-6.1-Sol
import { FileError, validString } from "./errors";

const EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["pdf", "application/pdf"],
  ["zip", "application/zip"],
  ["gz", "application/gzip"],
  ["tar", "application/x-tar"],
  ["mp3", "audio/mpeg"],
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["m4a", "audio/mp4"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  ["webm", "video/webm"],
  ["txt", "text/plain"],
  ["csv", "text/csv"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["ttl", "text/turtle"],
  ["nt", "application/n-triples"],
  ["nq", "application/n-quads"],
  ["trig", "application/trig"],
  ["jsonld", "application/ld+json"],
  ["json", "application/json"],
  ["rdf", "application/rdf+xml"],
  ["xml", "application/xml"],
  ["html", "text/html"],
  ["htm", "text/html"],
  ["css", "text/css"],
  ["js", "text/javascript"],
  ["ics", "text/calendar"],
  ["vcf", "text/vcard"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
]);

/** A filename hint only; unknown/no extension returns undefined. Never accepts a URL. */
export function guessContentType(name: string): string | undefined {
  validString(name, "invalid-name");
  if (!name || /[/\\\p{Cc}]/u.test(name)) throw new FileError("invalid-name");
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return EXTENSIONS.get(name.slice(dot + 1).toLowerCase());
}

function matches(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((byte, i) => bytes[offset + i] === byte)
  );
}

function ascii(bytes: Uint8Array, value: string, offset = 0): boolean {
  return matches(
    bytes,
    Array.from(value, (char) => char.charCodeAt(0)),
    offset,
  );
}

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes.length >= 10 && ascii(bytes, "ID3")) {
    const version = bytes[3] as number;
    return (
      version >= 2 &&
      version <= 4 &&
      bytes[4] !== 255 &&
      bytes.subarray(6, 10).every((byte) => byte < 128)
    );
  }
  const second = bytes[1] as number;
  const third = bytes[2] as number;
  return (
    bytes[0] === 255 &&
    (second & 0xe0) === 0xe0 &&
    (second & 0x18) !== 0x08 &&
    (second & 0x06) === 0x02 &&
    (third & 0xf0) !== 0 &&
    (third & 0xf0) !== 0xf0 &&
    (third & 0x0c) !== 0x0c
  );
}

function mp4Type(bytes: Uint8Array): string | undefined {
  if (bytes.length < 16 || !ascii(bytes, "ftyp", 4)) return undefined;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16 || size > bytes.length || size % 4 !== 0) return undefined;
  if (ascii(bytes, "M4A ", 8) || ascii(bytes, "M4B ", 8)) return "audio/mp4";
  if (
    ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash"].some(
      (brand) => ascii(bytes, brand, 8),
    )
  )
    return "video/mp4";
  return undefined;
}

/** Recognized signatures or strict UTF-8 text; undefined means unidentified binary/empty. */
export function sniffContentType(bytes: Uint8Array): string | undefined {
  if (!(bytes instanceof Uint8Array)) throw new FileError("invalid-bytes");
  if (matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (matches(bytes, [255, 216, 255])) return "image/jpeg";
  if (ascii(bytes, "GIF87a") || ascii(bytes, "GIF89a")) return "image/gif";
  if (ascii(bytes, "RIFF") && ascii(bytes, "WEBP", 8)) return "image/webp";
  if (ascii(bytes, "%PDF-")) return "application/pdf";
  if (
    matches(bytes, [80, 75, 3, 4]) ||
    matches(bytes, [80, 75, 5, 6]) ||
    matches(bytes, [80, 75, 7, 8])
  )
    return "application/zip";
  if (isMp3(bytes)) return "audio/mpeg";
  const mp4 = mp4Type(bytes);
  if (mp4) return mp4;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  if (!text || /[^\P{Cc}\t\n\r]/u.test(text)) return undefined;
  return "text/plain";
}

/** Binary magic wins; extensions refine plain text; unknowns stay opaque. */
export function detectContentType(name: string, bytes?: Uint8Array): string {
  const extension = guessContentType(name);
  const sniffed = bytes === undefined ? undefined : sniffContentType(bytes);
  if (sniffed && sniffed !== "text/plain") return sniffed;
  return extension ?? sniffed ?? "application/octet-stream";
}
