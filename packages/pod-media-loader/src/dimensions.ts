// AUTHORED-BY Claude Sonnet 5.5

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

const u16be = (b: Uint8Array, at: number): number =>
  ((b[at] as number) << 8) | (b[at + 1] as number);
const u16le = (b: Uint8Array, at: number): number =>
  (b[at] as number) | ((b[at + 1] as number) << 8);
const u32be = (b: Uint8Array, at: number): number =>
  (b[at] as number) * 0x1000000 +
  (((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number));
const ascii = (b: Uint8Array, at: number, text: string): boolean =>
  b.length >= at + text.length && [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0));

function png(b: Uint8Array): Dimensions | undefined {
  if (b.length < 24 || !ascii(b, 12, "IHDR")) return undefined;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gif(b: Uint8Array): Dimensions | undefined {
  if (b.length < 10) return undefined;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

/** Standalone markers carry no length: TEM, SOI, RSTn. */
const isStandalone = (marker: number): boolean =>
  marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);
/** SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC). */
const isFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpeg(b: Uint8Array): Dimensions | undefined {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return undefined;
    while (b[at + 1] === 0xff) at++;
    if (at + 4 > b.length) return undefined;
    const marker = b[at + 1] as number;
    if (isFrame(marker)) {
      if (at + 9 > b.length) return undefined;
      return { width: u16be(b, at + 7), height: u16be(b, at + 5) };
    }
    if (marker === 0xda) return undefined;
    at += isStandalone(marker) ? 2 : 2 + u16be(b, at + 2);
  }
  return undefined;
}

function webp(b: Uint8Array): Dimensions | undefined {
  if (ascii(b, 12, "VP8X") && b.length >= 30) {
    const w = (b[24] as number) | ((b[25] as number) << 8) | ((b[26] as number) << 16);
    const h = (b[27] as number) | ((b[28] as number) << 8) | ((b[29] as number) << 16);
    return { width: w + 1, height: h + 1 };
  }
  if (ascii(b, 12, "VP8L") && b.length >= 25 && b[20] === 0x2f) {
    const b0 = b[21] as number;
    const b1 = b[22] as number;
    const b2 = b[23] as number;
    const b3 = b[24] as number;
    return {
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }
  if (
    ascii(b, 12, "VP8 ") &&
    b.length >= 30 &&
    b[23] === 0x9d &&
    b[24] === 0x01 &&
    b[25] === 0x2a
  ) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return undefined;
}

/** The largest `ispe` (image spatial extents) box anywhere in the bytes: conservative for grids. */
function isobmffImage(b: Uint8Array): Dimensions | undefined {
  let best: Dimensions | undefined;
  for (let at = 4; at + 16 <= b.length; at++) {
    if (!ascii(b, at, "ispe")) continue;
    const width = u32be(b, at + 8);
    const height = u32be(b, at + 12);
    if (best === undefined || width * height > best.width * best.height) best = { width, height };
  }
  return best;
}

/**
 * Pixel dimensions read from the header bytes of a sniffed image type, or `undefined` when the
 * header is truncated or malformed or the type has no dimension reader. Never decodes pixels.
 */
export function imageDimensions(contentType: string, bytes: Uint8Array): Dimensions | undefined {
  switch (contentType) {
    case "image/png":
      return png(bytes);
    case "image/gif":
      return gif(bytes);
    case "image/jpeg":
      return jpeg(bytes);
    case "image/webp":
      return webp(bytes);
    case "image/avif":
    case "image/heic":
      return isobmffImage(bytes);
    default:
      return undefined;
  }
}
