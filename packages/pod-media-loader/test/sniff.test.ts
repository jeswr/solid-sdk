// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, test } from "vitest";
import { defaultSniff } from "../src/sniff.js";
import {
  avif,
  concat,
  flac,
  ftyp,
  gif,
  glb,
  heic,
  html,
  id3,
  jpeg,
  m4a,
  matroska,
  mov,
  mp3Frames,
  mp4,
  oggOpus,
  oggTheora,
  oggVorbis,
  png,
  svg,
  u32,
  utf16,
  wav,
  webm,
  webpExtended,
  webpLossless,
  webpLossy,
} from "./helpers.js";

const type = (bytes: Uint8Array) => defaultSniff(bytes)?.contentType;

describe("magic-byte sniffer: accepted formats", () => {
  test.each([
    ["png", png(), "image/png", ".png"],
    ["jpeg", jpeg(), "image/jpeg", ".jpg"],
    ["gif89a", gif(), "image/gif", ".gif"],
    ["gif87a", concat("GIF87a", [1, 0, 1, 0, 0, 0, 0]), "image/gif", ".gif"],
    ["webp lossy", webpLossy(), "image/webp", ".webp"],
    ["webp lossless", webpLossless(), "image/webp", ".webp"],
    ["webp extended", webpExtended(), "image/webp", ".webp"],
    ["avif", avif(), "image/avif", ".avif"],
    ["avif by compatible brand", concat(ftyp("mif1", "mif1", "avif")), "image/avif", ".avif"],
    ["avif sequence", concat(ftyp("avis", "avis")), "image/avif", ".avif"],
    ["heic", heic(), "image/heic", ".heic"],
    ["heix", concat(ftyp("heix", "heix")), "image/heic", ".heic"],
    ["heif with heic brand", concat(ftyp("mif1", "mif1", "heic")), "image/heic", ".heic"],
    ["mp4 isom", mp4(), "video/mp4", ".mp4"],
    ["m4v", concat(ftyp("M4V ", "M4V ")), "video/mp4", ".mp4"],
    ["m4a", m4a(), "audio/mp4", ".m4a"],
    ["quicktime", mov(), "video/quicktime", ".mov"],
    ["webm", webm(), "video/webm", ".webm"],
    ["wav", wav(), "audio/wav", ".wav"],
    ["flac", flac(), "audio/flac", ".flac"],
    ["glb", glb(), "model/gltf-binary", ".glb"],
    ["ogg vorbis", oggVorbis(), "audio/ogg", ".ogg"],
    ["ogg opus", oggOpus(), "audio/ogg", ".ogg"],
    ["mp3 with ID3", id3(), "audio/mpeg", ".mp3"],
    ["mp3 frames", mp3Frames(2), "audio/mpeg", ".mp3"],
  ])("%s", (_name, bytes, contentType, extension) => {
    expect(defaultSniff(bytes)).toEqual({ contentType, extension });
  });

  test("a JPEG may carry an XMP packet after its prolog", () => {
    const xmp = concat(jpeg(), new Uint8Array(100), '<?xml version="1.0"?><x:xmpmeta/>');
    expect(type(xmp)).toBe("image/jpeg");
  });

  test("markup after the first 512 bytes is not a polyglot signal (the type stays an image)", () => {
    expect(type(concat(gif(), new Uint8Array(600), "<script>alert(1)</script>"))).toBe("image/gif");
  });
});

describe("magic-byte sniffer: refusals", () => {
  test.each([
    ["empty", new Uint8Array(0)],
    ["one byte", new Uint8Array([0x89])],
    ["svg", svg()],
    ["svg with a BOM and a prolog", concat([0xef, 0xbb, 0xbf], '<?xml version="1.0"?><svg/>')],
    ["html", html()],
    ["plain text", concat("hello world")],
    ["json", concat('{"a":1}')],
    ["javascript", concat("alert(document.cookie)")],
    ["PNG signature cut short", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])],
    ["JPEG signature with no fourth byte", new Uint8Array([0xff, 0xd8, 0xff])],
    ["JPEG with a non-marker fourth byte", new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0, 0])],
    ["GIF with a wrong version", concat("GIF90a", new Uint8Array(10))],
    ["RIFF of an unknown form", concat("RIFF", [0, 0, 0, 0], "AVI ", new Uint8Array(8))],
    ["RIFF too short for a form", concat("RIFF", [0, 0, 0, 0])],
    ["ftyp with an unknown brand", concat(ftyp("zzzz", "zzzz"))],
    ["ftyp shorter than twelve bytes", concat([0, 0, 0, 8], "ftyp")],
    ["generic Matroska (not WebM)", matroska()],
    ["EBML with no DocType", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])],
    ["GLB version 1", concat("glTF", [1, 0, 0, 0], [12, 0, 0, 0])],
    ["GLB too short", concat("glTF", [2, 0, 0, 0])],
    ["GLB with a non-zero version high byte", concat("glTF", [2, 1, 0, 0], [12, 0, 0, 0])],
    ["Ogg Theora video", oggTheora()],
    ["Ogg with no codec", concat("OggS", new Uint8Array(40))],
    ["lone MPEG sync", new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5])],
    ["ID3 with a bad flag nibble", concat("ID3", [4, 0, 0x01, 0, 0, 0, 10])],
    ["ID3 with a 0xff version byte", concat("ID3", [0xff, 0, 0, 0, 0, 0, 10])],
    ["ID3 with a 0xff revision byte", concat("ID3", [4, 0xff, 0, 0, 0, 0, 10])],
    ["ID3 with a high size byte", concat("ID3", [4, 0, 0, 0, 0, 0, 0x80])],
    ["ID3 truncated", concat("ID3", [4, 0, 0])],
  ])("%s", (_name, bytes) => {
    expect(defaultSniff(bytes)).toBeUndefined();
  });

  test.each([
    ["reserved version", [0xff, 0xe1, 0x90, 0x00]],
    ["layer bits 00", [0xff, 0xf9, 0x90, 0x00]],
    ["free-format bitrate", [0xff, 0xfb, 0x00, 0x00]],
    ["bad bitrate 15", [0xff, 0xfb, 0xf0, 0x00]],
    ["reserved sample rate", [0xff, 0xfb, 0x9c, 0x00]],
    ["no frame sync bits", [0xff, 0x1b, 0x90, 0x00]],
  ])("an MPEG header with a %s is not audio", (_name, header) => {
    expect(type(concat(header, new Uint8Array(900)))).toBeUndefined();
  });

  test("two valid MPEG frames are required; a second invalid one fails", () => {
    const first = new Uint8Array(417);
    first.set([0xff, 0xfb, 0x90, 0x00]);
    expect(type(first)).toBeUndefined();
    expect(type(concat(first, new Uint8Array(417)))).toBeUndefined();
    expect(type(concat(first, [0xff, 0xfb, 0x90, 0x00]))).toBe("audio/mpeg");
  });

  // Independent of the sniffer: frame lengths straight from the MPEG audio frame formulas.
  const SampleRate = { 3: 44100, 2: 22050, 0: 11025 } as const;
  const Kbps = {
    "3-1": 32,
    "3-2": 32,
    "3-3": 32,
    "2-1": 32,
    "2-2": 8,
    "2-3": 8,
    "0-1": 32,
    "0-2": 8,
    "0-3": 8,
  } as const;
  const frameOf = (version: 3 | 2 | 0, layer: 1 | 2 | 3, padding: 0 | 1): Uint8Array => {
    const kbps = Kbps[`${version}-${layer}` as keyof typeof Kbps];
    const rate = SampleRate[version];
    const length =
      layer === 1
        ? (Math.floor((12 * kbps * 1000) / rate) + padding) * 4
        : Math.floor(((layer === 3 && version !== 3 ? 72 : 144) * kbps * 1000) / rate) + padding;
    const out = new Uint8Array(length);
    out.set([0xff, 0xe0 | (version << 3) | ((4 - layer) << 1) | 1, (1 << 4) | (padding << 1), 0]);
    return out;
  };

  test.each([
    [3, 1],
    [3, 2],
    [3, 3],
    [2, 1],
    [2, 2],
    [2, 3],
    [0, 3],
  ] as const)("MPEG version bits %i layer %i: two chained frames are audio/mpeg", (version, layer) => {
    for (const padding of [0, 1] as const) {
      const frame = frameOf(version, layer, padding);
      expect(type(concat(frame, frame))).toBe("audio/mpeg");
    }
  });
});

describe("magic-byte sniffer: polyglot guard", () => {
  test.each([
    [
      "svg in the first bytes after a PNG signature",
      concat(png().slice(0, 33), "<svg onload=alert(1)>"),
    ],
    ["html with image magic later is refused (markup before magic)", concat(html(), png())],
    ["PNG signature then html", concat(png().slice(0, 8), "<html><script>x</script>")],
    [
      "script after a GIF header",
      concat("GIF89a", [1, 0, 1, 0, 0, 0, 0], "<script>alert(1)</script>"),
    ],
    ["doctype in a JPEG comment", concat(jpeg().slice(0, 6), "<!DOCTYPE html>")],
    ["case-insensitive markup", concat(png().slice(0, 33), "<SvG/onload=alert(1)>")],
    [
      "xml prolog at the very start of a PNG body",
      concat(png().slice(0, 8), '<?xml version="1.0"?>'),
    ],
    [
      "UTF-16LE markup after a PNG signature",
      concat(png().slice(0, 8), utf16("<svg onload=alert(1)>")),
    ],
    ["UTF-16BE markup after a GIF header", concat("GIF89a", utf16("<html><body>", true))],
    [
      "NUL-padded markup after a WebP header",
      concat(webpLossy().slice(0, 30), utf16("<script>", false)),
    ],
  ])("%s", (_name, bytes) => {
    expect(defaultSniff(bytes)).toBeUndefined();
  });

  test("GIFAR-style: a GIF with a zip archive appended is typed as the GIF only", () => {
    const zip = concat("PK", [3, 4], new Uint8Array(40), "META-INF/MANIFEST.MF");
    expect(type(concat(gif(), zip))).toBe("image/gif");
  });

  test("magic that a server would call text/html is still just the image", () => {
    expect(type(png())).toBe("image/png");
  });

  test("a big-endian ftyp size field is read from the first four bytes", () => {
    expect(type(concat(u32(24), "ftypisom", u32(0), "isom", "mp42"))).toBe("video/mp4");
  });
});
