// AUTHORED-BY Claude Sonnet 5.5
import { type ByteView, bytesView } from "./view.js";

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

const u8 = (b: ByteView, at: number): number => b.at(at);
const u16be = (b: ByteView, at: number): number => (b.at(at) << 8) | b.at(at + 1);
const u16le = (b: ByteView, at: number): number => b.at(at) | (b.at(at + 1) << 8);
const u32be = (b: ByteView, at: number): number =>
  b.at(at) * 0x1000000 + ((b.at(at + 1) << 16) | (b.at(at + 2) << 8) | b.at(at + 3));
const ascii = (b: ByteView, at: number, text: string): boolean =>
  b.length >= at + text.length && [...text].every((ch, i) => b.at(at + i) === ch.charCodeAt(0));

const largest = (a: Dimensions | undefined, b: Dimensions): Dimensions =>
  a === undefined || b.width * b.height > a.width * a.height ? b : a;

function png(b: ByteView): Dimensions | undefined {
  if (b.length < 24 || !ascii(b, 12, "IHDR")) return undefined;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** Frames and extension blocks walked before a GIF is refused as unparseable. */
const MAX_GIF_BLOCKS = 100_000;

/**
 * The largest of the logical screen and every image descriptor's extent (left + width, top +
 * height), because decoders grow the canvas to a larger frame. The whole block structure is walked
 * (colour tables, extensions and image data are skipped by their lengths); a truncated or
 * malformed stream, or one with no frame, has no dimensions.
 */
function gif(b: ByteView): Dimensions | undefined {
  if (b.length < 13) return undefined;
  let best: Dimensions = { width: u16le(b, 6), height: u16le(b, 8) };
  let at = 13;
  const packed = u8(b, 10);
  if (packed & 0x80) at += 3 * 2 ** ((packed & 7) + 1);
  let frames = 0;
  for (let blocks = 0; blocks < MAX_GIF_BLOCKS; blocks++) {
    if (at >= b.length) return undefined;
    const introducer = u8(b, at);
    if (introducer === 0x3b) return frames > 0 ? best : undefined;
    if (introducer === 0x2c) {
      if (at + 10 > b.length) return undefined;
      best = largest(best, {
        width: u16le(b, at + 1) + u16le(b, at + 5),
        height: u16le(b, at + 3) + u16le(b, at + 7),
      });
      frames++;
      const local = u8(b, at + 9);
      at += 10;
      if (local & 0x80) at += 3 * 2 ** ((local & 7) + 1);
      at += 1; // LZW minimum code size
    } else if (introducer === 0x21) {
      at += 2; // introducer and label
    } else {
      return undefined;
    }
    // Sub-blocks: length-prefixed, ended by a zero length.
    for (;;) {
      if (at >= b.length) return undefined;
      const length = u8(b, at);
      at += 1 + length;
      if (length === 0) break;
    }
  }
  return undefined;
}

/** Standalone markers carry no length: TEM, SOI, RSTn. */
const isStandalone = (marker: number): boolean =>
  marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);
/** SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC). */
const isFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpeg(b: ByteView): Dimensions | undefined {
  let at = 2;
  while (at + 4 <= b.length) {
    if (u8(b, at) !== 0xff) return undefined;
    while (u8(b, at + 1) === 0xff) at++;
    if (at + 4 > b.length) return undefined;
    const marker = u8(b, at + 1);
    if (isFrame(marker)) {
      if (at + 9 > b.length) return undefined;
      return { width: u16be(b, at + 7), height: u16be(b, at + 5) };
    }
    if (marker === 0xda) return undefined;
    at += isStandalone(marker) ? 2 : 2 + u16be(b, at + 2);
  }
  return undefined;
}

function webp(b: ByteView): Dimensions | undefined {
  if (ascii(b, 12, "VP8X") && b.length >= 30) {
    const w = u8(b, 24) | (u8(b, 25) << 8) | (u8(b, 26) << 16);
    const h = u8(b, 27) | (u8(b, 28) << 8) | (u8(b, 29) << 16);
    return { width: w + 1, height: h + 1 };
  }
  if (ascii(b, 12, "VP8L") && b.length >= 25 && u8(b, 20) === 0x2f) {
    const b0 = u8(b, 21);
    const b1 = u8(b, 22);
    const b2 = u8(b, 23);
    const b3 = u8(b, 24);
    return {
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }
  if (
    ascii(b, 12, "VP8 ") &&
    b.length >= 30 &&
    u8(b, 23) === 0x9d &&
    u8(b, 24) === 0x01 &&
    u8(b, 25) === 0x2a
  ) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return undefined;
}

// ---- ISO base media file format (AVIF, HEIC) ----

const MAX_BOXES = 4096;

interface Box {
  readonly type: string;
  /** Offset of the payload and of the end of the box. */
  readonly start: number;
  readonly end: number;
}

/** Child boxes of [from, to). `undefined` when a box header is malformed or overruns `to`. */
function boxes(b: ByteView, from: number, to: number, budget: { left: number }): Box[] | undefined {
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    if (--budget.left < 0 || at + 8 > to) return undefined;
    let size = u32be(b, at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to || u32be(b, at + 8) !== 0) return undefined;
      size = u32be(b, at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return undefined;
    out.push({
      type: String.fromCharCode(b.at(at + 4), b.at(at + 5), b.at(at + 6), b.at(at + 7)),
      start: at + header,
      end: at + size,
    });
    at += size;
  }
  return out;
}

/** The boxes inside `parent`, after `skip` bytes of full-box header. */
function within(
  b: ByteView,
  parent: Box,
  skip: number,
  budget: { left: number },
): Box[] | undefined {
  return boxes(b, parent.start + skip, parent.end, budget);
}

function ispeOf(b: ByteView, ispe: Box): Dimensions | undefined {
  if (ispe.end - ispe.start < 12) return undefined;
  return { width: u32be(b, ispe.start + 4), height: u32be(b, ispe.start + 8) };
}

/** `tkhd` width and height are 16.16 fixed point, after a version-dependent prefix. */
function tkhdOf(b: ByteView, tkhd: Box): Dimensions | undefined {
  const version = u8(b, tkhd.start);
  const at = tkhd.start + (version === 1 ? 88 : 76);
  if (tkhd.end < at + 8) return undefined;
  return { width: u32be(b, at) >>> 16, height: u32be(b, at + 4) >>> 16 };
}

function isobmffImage(b: ByteView): Dimensions | undefined {
  const budget = { left: MAX_BOXES };
  const top = boxes(b, 0, b.length, budget);
  const ftyp = top?.find((box) => box.type === "ftyp");
  if (top === undefined || ftyp === undefined) return undefined;
  let sequence = false;
  for (let at = ftyp.start; at + 4 <= ftyp.end; at += 4) {
    // The slot after the major brand is the minor version, not a brand.
    if (at !== ftyp.start + 4 && ascii(b, at, "avis")) sequence = true;
  }
  let best: Dimensions | undefined;
  for (const meta of top.filter((box) => box.type === "meta")) {
    const iprp = within(b, meta, 4, budget)?.find((box) => box.type === "iprp");
    const ipco = iprp && within(b, iprp, 0, budget)?.find((box) => box.type === "ipco");
    if (ipco === undefined) return undefined;
    const props = within(b, ipco, 0, budget);
    if (props === undefined) return undefined;
    for (const ispe of props.filter((box) => box.type === "ispe")) {
      const size = ispeOf(b, ispe);
      if (size === undefined) return undefined;
      best = largest(best, size);
    }
  }
  if (sequence) {
    for (const moov of top.filter((box) => box.type === "moov")) {
      const traks = within(b, moov, 0, budget)?.filter((box) => box.type === "trak");
      if (traks === undefined) return undefined;
      for (const trak of traks) {
        const children = within(b, trak, 0, budget);
        if (children === undefined) return undefined;
        for (const tkhd of children.filter((box) => box.type === "tkhd")) {
          const size = tkhdOf(b, tkhd);
          if (size === undefined) return undefined;
          best = largest(best, size);
        }
      }
    }
  }
  return best;
}

/**
 * Pixel dimensions read from the header bytes of a sniffed image type, or `undefined` when the
 * header is truncated or malformed or the type has no dimension reader. Never decodes pixels.
 * GIF takes the largest frame, AVIF/HEIC walk the box tree (`meta/iprp/ipco/ispe`, and for an
 * `avis` sequence also `moov/trak/tkhd`) and take the largest extent.
 */
export function imageDimensions(
  contentType: string,
  bytes: Uint8Array | ByteView,
): Dimensions | undefined {
  const b = bytes instanceof Uint8Array ? bytesView(bytes) : bytes;
  switch (contentType) {
    case "image/png":
      return png(b);
    case "image/gif":
      return gif(b);
    case "image/jpeg":
      return jpeg(b);
    case "image/webp":
      return webp(b);
    case "image/avif":
    case "image/heic":
      return isobmffImage(b);
    default:
      return undefined;
  }
}
