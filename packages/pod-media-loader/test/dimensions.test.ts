// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, test } from "vitest";
import { imageDimensions } from "../src/dimensions.js";
import {
  avif,
  concat,
  gif,
  heic,
  jpeg,
  mp4,
  png,
  u16,
  u32,
  webpExtended,
  webpLossless,
  webpLossy,
} from "./helpers.js";

describe("image dimensions from header bytes", () => {
  test.each([
    ["png", "image/png", png(640, 480)],
    ["png at the 32-bit edge", "image/png", png(0xffffffff, 2)],
    ["jpeg", "image/jpeg", jpeg(640, 480)],
    ["gif", "image/gif", gif(640, 480)],
    ["webp lossy", "image/webp", webpLossy(640, 480)],
    ["webp lossless", "image/webp", webpLossless(640, 480)],
    ["webp extended", "image/webp", webpExtended(640, 480)],
    ["avif", "image/avif", avif(640, 480)],
    ["heic", "image/heic", heic(640, 480)],
  ])("%s", (_name, type, bytes) => {
    const expected = _name === "png at the 32-bit edge" ? [0xffffffff, 2] : [640, 480];
    expect(imageDimensions(type, bytes)).toEqual({ width: expected[0], height: expected[1] });
  });

  test("a WebP lossless header packs 14-bit sizes", () => {
    expect(imageDimensions("image/webp", webpLossless(16384, 1))).toEqual({
      width: 16384,
      height: 1,
    });
  });

  test("an AVIF grid reports the largest ispe box", () => {
    const grid = concat(avif(100, 100), avif(4000, 3000));
    expect(imageDimensions("image/avif", grid)).toEqual({ width: 4000, height: 3000 });
    const reversed = concat(avif(4000, 3000), avif(100, 100));
    expect(imageDimensions("image/avif", reversed)).toEqual({ width: 4000, height: 3000 });
  });

  test("an AVIF with no ispe box has no dimensions", () => {
    expect(imageDimensions("image/avif", mp4())).toBeUndefined();
    expect(imageDimensions("image/avif", new Uint8Array(3))).toBeUndefined();
  });

  test("types without a reader have no dimensions", () => {
    expect(imageDimensions("video/mp4", mp4())).toBeUndefined();
    expect(imageDimensions("image/x-unknown", png())).toBeUndefined();
  });

  test.each([
    ["png too short", "image/png", png().slice(0, 23)],
    ["png without IHDR", "image/png", concat(png().slice(0, 12), "XXXX", new Uint8Array(20))],
    ["gif too short", "image/gif", gif().slice(0, 9)],
    ["webp too short for VP8X", "image/webp", webpExtended().slice(0, 29)],
    ["webp too short for VP8L", "image/webp", webpLossless().slice(0, 24)],
    [
      "webp lossless without its signature byte",
      "image/webp",
      concat(webpLossless().slice(0, 20), [0x00], webpLossless().slice(21)),
    ],
    ["webp too short for VP8", "image/webp", webpLossy().slice(0, 29)],
    [
      "webp lossy without a start code (first byte)",
      "image/webp",
      concat(webpLossy().slice(0, 23), [0x00, 0x01, 0x2a], webpLossy().slice(26)),
    ],
    [
      "webp lossy without a start code (second byte)",
      "image/webp",
      concat(webpLossy().slice(0, 23), [0x9d, 0x00, 0x2a], webpLossy().slice(26)),
    ],
    [
      "webp lossy without a start code (third byte)",
      "image/webp",
      concat(webpLossy().slice(0, 23), [0x9d, 0x01, 0x00], webpLossy().slice(26)),
    ],
    [
      "webp with an unknown chunk",
      "image/webp",
      concat(webpLossy().slice(0, 12), "ALPH", webpLossy().slice(16)),
    ],
  ])("%s", (_name, type, bytes) => {
    expect(imageDimensions(type, bytes)).toBeUndefined();
  });
});

describe("jpeg marker walk", () => {
  const soi = [0xff, 0xd8];
  const sof = (w: number, h: number, marker = 0xc0) => [
    0xff,
    marker,
    0x00,
    0x11,
    8,
    ...u16(h),
    ...u16(w),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  const app = (length: number) => [0xff, 0xe1, ...u16(length), ...new Array(length - 2).fill(0)];

  test("skips APPn segments to find the frame header", () => {
    expect(imageDimensions("image/jpeg", concat(soi, app(40), sof(800, 600)))).toEqual({
      width: 800,
      height: 600,
    });
  });

  test("accepts progressive and other SOF markers, skips DHT/JPG/DAC", () => {
    for (const marker of [0xc1, 0xc2, 0xc3, 0xc5, 0xc9, 0xcf]) {
      expect(imageDimensions("image/jpeg", concat(soi, sof(10, 20, marker)))).toEqual({
        width: 10,
        height: 20,
      });
    }
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      const skipped = [0xff, marker, 0x00, 0x04, 0, 0];
      expect(imageDimensions("image/jpeg", concat(soi, skipped, sof(10, 20)))).toEqual({
        width: 10,
        height: 20,
      });
    }
  });

  test("steps over fill bytes and standalone markers", () => {
    const standalone = [0xff, 0x01, 0xff, 0xd8, 0xff, 0xd0, 0xff, 0xd7];
    expect(
      imageDimensions("image/jpeg", concat(soi, [0xff, 0xff, 0xff], standalone, sof(5, 6))),
    ).toEqual({
      width: 5,
      height: 6,
    });
  });

  test("refuses a stream that reaches the scan before a frame header", () => {
    expect(
      imageDimensions("image/jpeg", concat(soi, [0xff, 0xda, 0x00, 0x04, 0, 0])),
    ).toBeUndefined();
  });

  test("refuses a segment that is not introduced by 0xff", () => {
    expect(imageDimensions("image/jpeg", concat(soi, [0x00, 0xc0, 0, 0, 0, 0]))).toBeUndefined();
  });

  test("refuses truncated headers and fill bytes that run off the end", () => {
    expect(imageDimensions("image/jpeg", concat(soi, sof(1, 1).slice(0, 8)))).toBeUndefined();
    expect(imageDimensions("image/jpeg", concat(soi, [0xff, 0xff, 0xff, 0xff]))).toBeUndefined();
    expect(imageDimensions("image/jpeg", new Uint8Array(soi))).toBeUndefined();
    expect(imageDimensions("image/jpeg", concat(soi, app(200).slice(0, 20)))).toBeUndefined();
  });

  test("a segment length that overshoots the file ends the walk", () => {
    expect(
      imageDimensions("image/jpeg", concat(soi, [0xff, 0xe1, 0xff, 0xff, 0, 0])),
    ).toBeUndefined();
  });

  test("u32 helper sanity", () => {
    expect(u32(0x01020304)).toEqual([1, 2, 3, 4]);
  });
});
