// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  detectContentType,
  FileError,
  guessContentType,
  sniffContentType,
} from "../src/apps/drive/lib/files";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
function ftyp(brand: string, size = 16): Uint8Array {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(utf8(`ftyp${brand}`), 4);
  return bytes;
}
const signatures: [string, Uint8Array, string][] = [
  ["PNG", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
  ["JPEG", new Uint8Array([255, 216, 255, 224]), "image/jpeg"],
  ["GIF87a", utf8("GIF87a"), "image/gif"],
  ["GIF89a", utf8("GIF89a"), "image/gif"],
  ["WebP", new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]), "image/webp"],
  ["PDF", utf8("%PDF-1.7\n"), "application/pdf"],
  ["ZIP local header", new Uint8Array([80, 75, 3, 4]), "application/zip"],
  ["ZIP empty archive", new Uint8Array([80, 75, 5, 6]), "application/zip"],
  ["ZIP data descriptor", new Uint8Array([80, 75, 7, 8]), "application/zip"],
  ["ID3v2 MP3", new Uint8Array([73, 68, 51, 2, 0, 0, 0, 0, 0, 0]), "audio/mpeg"],
  ["ID3v3 MP3", new Uint8Array([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]), "audio/mpeg"],
  ["ID3v4 MP3", new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]), "audio/mpeg"],
  ["MPEG1 layer III", new Uint8Array([255, 251, 144, 100]), "audio/mpeg"],
  ["MPEG2 layer III", new Uint8Array([255, 243, 144, 100]), "audio/mpeg"],
  ["MPEG2.5 layer III", new Uint8Array([255, 227, 144, 100]), "audio/mpeg"],
  ["MP4 isom", ftyp("isom"), "video/mp4"],
  ["MP4 mp42", ftyp("mp42"), "video/mp4"],
  ["MP4 M4A", ftyp("M4A "), "audio/mp4"],
  ["MP4 M4B", ftyp("M4B "), "audio/mp4"],
];

describe("Drive MIME detection", () => {
  it.each([
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
  ])("maps .%s case-insensitively", (extension, expected) => {
    expect(guessContentType(`name.${extension}`)).toBe(expected);
    expect(guessContentType(`name.${extension.toUpperCase()}`)).toBe(expected);
    expect(detectContentType(`name.${extension}`)).toBe(expected);
  });

  it.each([
    "README",
    ".png",
    "name.",
    "x.unknown",
    "name.png?query",
    "x.toString",
    "x.constructor",
    "x.__proto__",
  ])("leaves unknown filename %s unidentified", (name) =>
    expect(guessContentType(name)).toBeUndefined());

  it.each([
    "",
    "https://example.org/x.png",
    "a/b.png",
    "a\\b.png",
    "a\u0000.png",
    "\ud800",
  ])("rejects malformed names and paths %j", (name) =>
    expect(() => guessContentType(name)).toThrow(FileError));

  it("uses the final suffix for MIME rather than the whole extension chain", () => {
    expect(guessContentType("name.tar.gz")).toBe("application/gzip");
    expect(guessContentType(".config.json")).toBe("application/json");
  });

  it.each(
    signatures,
  )("sniffs synthetic %s bytes independently of extension", (_name, bytes, mime) => {
    const snapshot = bytes.slice();
    expect(sniffContentType(bytes)).toBe(mime);
    expect(detectContentType("misleading.txt", bytes)).toBe(mime);
    expect(bytes).toEqual(snapshot);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 3);
    expect(sniffContentType(padded.subarray(3, 3 + bytes.length))).toBe(mime);
  });

  it.each([
    new Uint8Array(),
    new Uint8Array([137, 80, 78, 71, 13, 10, 26]),
    new Uint8Array([255, 216]),
    new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]),
    new Uint8Array([255, 0, 144, 100]),
    new Uint8Array([255, 235, 144, 100]),
    new Uint8Array([255, 253, 144, 100]),
    new Uint8Array([255, 251, 0, 100]),
    new Uint8Array([255, 251, 240, 100]),
    new Uint8Array([255, 251, 156, 100]),
    new Uint8Array([255, 241, 80, 128]), // AAC ADTS is not MP3.
    new Uint8Array([73, 68, 51, 1, 0, 0, 0, 0, 0, 0]),
    new Uint8Array([73, 68, 51, 5, 0, 0, 0, 0, 0, 0]),
    new Uint8Array([73, 68, 51, 4, 255, 0, 0, 0, 0, 0]),
    new Uint8Array([73, 68, 51, 4, 0, 0, 128, 0, 0, 0]),
    ftyp("heic"),
    ftyp("isom", 0),
    ftyp("isom", 1),
    ftyp("isom", 20),
    ftyp("isom", 17),
    new Uint8Array([0xc0, 0xaf]), // Overlong UTF-8.
    new Uint8Array([0xed, 0xa0, 0x80]), // UTF-8 surrogate.
    new Uint8Array([0xf0, 0x9f]), // Truncated UTF-8.
    new Uint8Array([0xff, 0xfe, 65, 0]), // UTF-16 is outside the text sniffing subset.
    utf8("a\u0000b"),
    utf8("a\u007fb"),
    utf8("a\u0085b"),
    utf8("\uFEFF"),
  ])("leaves unknown, unsupported, or invalid binary unidentified %#", (bytes) => {
    expect(sniffContentType(bytes)).toBeUndefined();
    expect(detectContentType("unknown", bytes)).toBe("application/octet-stream");
  });

  it.each([
    "Hello, fictional world!\n",
    "日本語 Café 💡",
    "a\tb\r\nc",
    "\uFEFFHello",
    "<html>synthetic</html>",
  ])("recognizes UTF-8 text without inferring active formats", (text) => {
    expect(sniffContentType(utf8(text))).toBe("text/plain");
    expect(detectContentType("README", utf8(text))).toBe("text/plain");
  });

  it("refines plain text via the table and keeps the explicit opaque fallback", () => {
    expect(detectContentType("notes.md", utf8("# Synthetic notes"))).toBe("text/markdown");
    expect(detectContentType("data.jsonld", utf8("{}"))).toBe("application/ld+json");
    expect(detectContentType("data.ttl", utf8("# synthetic"))).toBe("text/turtle");
    expect(detectContentType("photo.png", new Uint8Array())).toBe("image/png");
    expect(detectContentType("unknown")).toBe("application/octet-stream");
    expect(sniffContentType(utf8("GIF88a"))).toBe("text/plain");
    expect(sniffContentType(utf8("RIFFnotwebp"))).toBe("text/plain");
    expect(sniffContentType(utf8("ID3"))).toBe("text/plain");
  });

  it.each([
    null,
    [],
    new ArrayBuffer(4),
    new DataView(new ArrayBuffer(4)),
  ])("rejects non-byte input %#", (bytes) => {
    expect(() => sniffContentType(bytes as unknown as Uint8Array)).toThrow(
      expect.objectContaining({ code: "invalid-bytes" }),
    );
  });
});
