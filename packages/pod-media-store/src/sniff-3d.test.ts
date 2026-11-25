// AUTHORED-BY Claude Sonnet 5.5
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { defaultSniff, SNIFF_BYTES } from "./sniff.js";

const enc = (text: string) => new TextEncoder().encode(text);
const PLY = { contentType: "application/octet-stream", extension: ".ply" };
const SPZ = { contentType: "application/octet-stream", extension: ".spz" };
const spz = { extension: ".spz" };

/** A version 4 SPZ header: `NGSP`, version, point count, SH degree, ... (32 bytes, LE). */
function ngsp(version = 4, shDegree = 3, size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(enc("NGSP"));
  new DataView(bytes.buffer).setUint32(4, version, true);
  bytes[12] = shDegree;
  return bytes;
}
/** A gzip member header (deflate, no flags) padded with arbitrary payload. */
const gz = (patch: Record<number, number> = {}, size = 32) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x1f, 0x8b, 0x08, 0x00]);
  for (const [at, value] of Object.entries(patch)) bytes[Number(at)] = value;
  return bytes;
};

describe("defaultSniff: PLY", () => {
  it.each([
    ["ascii", "ply\nformat ascii 1.0\nelement vertex 3\nend_header\n0 0 0\n"],
    ["binary little endian", "ply\nformat binary_little_endian 1.0\nend_header\n"],
    ["binary big endian", "ply\nformat binary_big_endian 1.0\nend_header\n"],
    ["CRLF line ends", "ply\r\nformat ascii 1.0\r\nend_header\r\n"],
    [
      "comments and obj_info before format",
      "ply\ncomment made by x\nobj_info\nobj_info y\nformat ascii 1.0\n",
    ],
    ["a bare comment line", "ply\ncomment\nformat ascii 1.0\n"],
  ])("recognises %s as an opaque model", (_name, text) => {
    expect(defaultSniff(enc(text))).toEqual(PLY);
  });

  it("recognises a binary body after the header", () => {
    const head = enc("ply\nformat binary_little_endian 1.0\nend_header\n");
    const bytes = new Uint8Array(head.length + 12);
    bytes.set(head);
    bytes.set([0xff, 0x00, 0x80, 0x7f], head.length);
    expect(defaultSniff(bytes)).toEqual(PLY);
  });

  it.each([
    ["empty", ""],
    ["magic only", "ply"],
    ["magic and newline only", "ply\n"],
    ["upper case magic", "PLY\nformat ascii 1.0\n"],
    ["magic not followed by a newline", "plyx\nformat ascii 1.0\n"],
    ["a lone carriage return", "ply\rformat ascii 1.0\n"],
    ["CR then something other than LF", "ply\rXformat ascii 1.0\n"],
    ["no format line yet", "ply\ncomment hello\n"],
    ["an incomplete format line", "ply\nformat ascii 1.0"],
    ["an unknown format", "ply\nformat utf8 1.0\n"],
    ["an unsupported version", "ply\nformat ascii 2.0\n"],
    ["format with trailing text", "ply\nformat ascii 1.0 extra\n"],
    ["a non-header line before format", "ply\nelement vertex 3\nformat ascii 1.0\n"],
    ["a control character in a comment", "ply\ncomment a\u0001b\nformat ascii 1.0\n"],
    ["a non-ASCII byte in a comment", "ply\ncomment café\nformat ascii 1.0\n"],
    ["a comment that is not a header comment", "ply\ncommentary\nformat ascii 1.0\n"],
  ])("refuses %s", (_name, text) => {
    expect(defaultSniff(enc(text))).toBeUndefined();
  });

  it("refuses a CR line end with no LF after it", () => {
    expect(defaultSniff(Uint8Array.from([0x70, 0x6c, 0x79, 0x0d]))).toBeUndefined();
  });

  it("needs the format line within the bytes the store sniffs", () => {
    const late = `ply\n${"comment x\n".repeat(600)}format ascii 1.0\n`;
    expect(enc(late).length).toBeGreaterThan(SNIFF_BYTES);
    expect(defaultSniff(enc(late).subarray(0, SNIFF_BYTES))).toBeUndefined();
    const early = `ply\nformat ascii 1.0\n${"comment x\n".repeat(600)}`;
    expect(defaultSniff(enc(early).subarray(0, SNIFF_BYTES))).toEqual(PLY);
  });

  it.each([
    ["an svg in a comment", "ply\nformat ascii 1.0\ncomment <svg onload=alert(1)>\n"],
    ["html in a comment", "ply\nformat ascii 1.0\ncomment <!DOCTYPE html><html>\n"],
    ["a script in a comment", "ply\nformat ascii 1.0\ncomment <script>alert(1)</script>\n"],
    ["an xml prolog at the start of the header", "ply\nformat ascii 1.0\ncomment <?xml version\n"],
    [
      "markup later in the first 512 bytes",
      `ply\nformat ascii 1.0\ncomment ${"a".repeat(300)}<SVG/>\n`,
    ],
  ])("refuses a polyglot with %s", (_name, text) => {
    expect(defaultSniff(enc(text))).toBeUndefined();
  });

  it("is never reported as markup, whatever extension is declared", () => {
    const bytes = enc("ply\nformat ascii 1.0\nend_header\n");
    for (const extension of [".svg", ".html", ".xml", ".spz", undefined]) {
      expect(defaultSniff(bytes, { extension })).toEqual(PLY);
    }
  });
});

describe("defaultSniff: SPZ", () => {
  it.each([
    ["a version 4 header", ngsp()],
    ["a version 4 header with no SH", ngsp(4, 0)],
    ["a version 4 header with SH degree 4", ngsp(4, 4)],
    ["a gzip member (versions 1 to 3)", gz()],
    ["a gzip member with a name flag", gz({ 3: 0x08 })],
    ["a minimal gzip member header", gz({}, 10)],
    ["a real gzip stream", Uint8Array.from(gzipSync(Uint8Array.from([1, 2, 3, 4])))],
  ])("accepts %s when .spz is declared", (_name, bytes) => {
    expect(defaultSniff(bytes, spz)).toEqual(SPZ);
  });

  it.each([
    ".spz",
    "spz",
    ".SPZ",
    "Spz",
    "  .spz  ",
  ])("accepts the declared extension %j in any spelling", (extension) => {
    expect(defaultSniff(ngsp(), { extension })).toEqual(SPZ);
    expect(defaultSniff(gz(), { extension })).toEqual(SPZ);
  });

  it.each([
    ["no hints", undefined],
    ["empty hints", {}],
    ["an undefined extension", { extension: undefined }],
    ["an empty extension", { extension: "" }],
    [".gz", { extension: ".gz" }],
    [".spz.gz", { extension: ".spz.gz" }],
    [".ply", { extension: ".ply" }],
    [".svg", { extension: ".svg" }],
    ["a different extension that merely contains spz", { extension: ".xspz" }],
  ])("never accepts gzip or NGSP as a general type: %s", (_name, hints) => {
    expect(defaultSniff(gz(), hints)).toBeUndefined();
    expect(defaultSniff(ngsp(), hints)).toBeUndefined();
    expect(defaultSniff(Uint8Array.from(gzipSync(enc("x"))), hints)).toBeUndefined();
  });

  it.each([
    ["a gzip with another compression method", gz({ 2: 0x07 })],
    ["a gzip with a reserved flag bit", gz({ 3: 0x20 })],
    ["a gzip with every reserved flag bit", gz({ 3: 0xe0 })],
    ["a gzip shorter than its fixed header", gz({}, 9)],
    ["only the gzip magic", Uint8Array.from([0x1f, 0x8b, 0x08])],
    ["NGSP with version 3", ngsp(3)],
    ["NGSP with version 5", ngsp(5)],
    [
      "NGSP with a big-endian version",
      (() => {
        const bytes = ngsp(0);
        new DataView(bytes.buffer).setUint32(4, 4, false);
        return bytes;
      })(),
    ],
    ["NGSP with SH degree 5", ngsp(4, 5)],
    ["NGSP shorter than its header", ngsp(4, 3, 31)],
    ["just NGSP", enc("NGSP")],
    [
      "lowercase ngsp",
      (() => {
        const bytes = ngsp();
        bytes.set(enc("ngsp"));
        return bytes;
      })(),
    ],
    ["a zstd frame", Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0, 0, 0, 0, 0])],
    ["empty bytes", new Uint8Array()],
  ])("refuses %s even when .spz is declared", (_name, bytes) => {
    expect(defaultSniff(bytes, spz)).toBeUndefined();
  });

  it("reads NGSP through a view that does not start at the buffer's origin", () => {
    const padded = new Uint8Array(40);
    padded.set(ngsp(), 8);
    expect(defaultSniff(padded.subarray(8), spz)).toEqual(SPZ);
  });

  it("refuses a polyglot whose compressed bytes carry markup near the start", () => {
    const withSvg = gz({}, 64);
    withSvg.set(enc('<svg onload="alert(1)">'), 12);
    expect(defaultSniff(withSvg, spz)).toBeUndefined();
    const withHtml = ngsp();
    withHtml.set(enc("<HTML>"), 20);
    expect(defaultSniff(withHtml, spz)).toBeUndefined();
    const withProlog = gz();
    withProlog.set(enc("<?xml version"), 11);
    expect(defaultSniff(withProlog, spz)).toBeUndefined();
  });

  it("cannot see inside the compressed stream: an inflated markup head is still just opaque bytes", () => {
    // Accepted, and reported as application/octet-stream with extension .spz, never as markup.
    const stream = Uint8Array.from(
      gzipSync(enc('<svg xmlns="http://www.w3.org/2000/svg" onload="x"/>')),
    );
    expect(defaultSniff(stream, spz)).toEqual(SPZ);
  });

  it("does not change what the other formats are, whatever extension is declared", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(defaultSniff(png, spz)?.contentType).toBe("image/png");
    expect(defaultSniff(enc("not a known format"), spz)).toBeUndefined();
  });
});
