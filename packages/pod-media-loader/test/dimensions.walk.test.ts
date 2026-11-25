// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, test } from "vitest";
import { imageDimensions } from "../src/dimensions.js";
import { bytesView, chunksView, prefixOf } from "../src/view.js";
import {
  avif,
  avis,
  box,
  concat,
  ftyp,
  gif,
  gifFrames,
  heic,
  mp4,
  png,
  u16le,
  u32,
} from "./helpers.js";

const dims = (type: string, bytes: Uint8Array) => imageDimensions(type, bytes);

describe("GIF: the largest of the screen and every frame", () => {
  test("a frame larger than the logical screen wins (the bypass the review reproduced)", () => {
    expect(dims("image/gif", gifFrames([1, 1], [[65535, 65535]]))).toEqual({
      width: 65535,
      height: 65535,
    });
  });

  test("a later frame can be the largest, and a smaller frame never shrinks the screen", () => {
    expect(
      dims(
        "image/gif",
        gifFrames(
          [10, 10],
          [
            [5, 5],
            [300, 200],
            [7, 7],
          ],
        ),
      ),
    ).toEqual({
      width: 300,
      height: 200,
    });
    expect(dims("image/gif", gifFrames([400, 300], [[5, 5]]))).toEqual({ width: 400, height: 300 });
  });

  test("frame offsets count towards the extent", () => {
    const framed = concat(
      "GIF89a",
      u16le(10),
      u16le(10),
      [0, 0, 0],
      [0x2c],
      u16le(1000),
      u16le(2000),
      u16le(5),
      u16le(5),
      [0, 2, 1, 0, 0],
      [0x3b],
    );
    expect(dims("image/gif", framed)).toEqual({ width: 1005, height: 2005 });
  });

  test("colour tables and extension blocks are skipped", () => {
    expect(
      dims(
        "image/gif",
        gifFrames([1, 1], [[40, 30]], { globalTable: true, localTable: true, extension: true }),
      ),
    ).toEqual({ width: 40, height: 30 });
  });

  test.each([
    ["no frame at all", concat("GIF89a", u16le(9), u16le(9), [0, 0, 0], [0x3b])],
    ["a header that is too short", concat("GIF89a", [1, 0])],
    ["a stream that ends before its trailer", gifFrames([1, 1], [[1, 1]]).slice(0, -1)],
    [
      "an image descriptor cut short",
      concat("GIF89a", u16le(1), u16le(1), [0, 0, 0], [0x2c, 0, 0]),
    ],
    [
      "image data that never terminates",
      concat(
        "GIF89a",
        u16le(1),
        u16le(1),
        [0, 0, 0],
        [0x2c, 0, 0, 0, 0],
        u16le(1),
        u16le(1),
        [0, 2, 5, 1, 2],
      ),
    ],
    ["an unknown block introducer", concat("GIF89a", u16le(1), u16le(1), [0, 0, 0], [0x99])],
    ["nothing after the screen descriptor", concat("GIF89a", u16le(1), u16le(1), [0, 0, 0])],
  ])("%s has no dimensions", (_name, bytes) => {
    expect(dims("image/gif", bytes)).toBeUndefined();
  });

  test("a stream of endless empty extensions is refused after a bound", () => {
    const endless = concat(
      "GIF89a",
      u16le(1),
      u16le(1),
      [0, 0, 0],
      ...Array.from({ length: 100_100 }, () => [0x21, 0xfe, 0]),
    );
    expect(dims("image/gif", endless)).toBeUndefined();
  });

  test("a plain one-frame GIF is its own size", () => {
    expect(dims("image/gif", gif(12, 34))).toEqual({ width: 12, height: 34 });
  });
});

describe("ISO base media: a real box walk", () => {
  test("avif and heic read ispe under meta/iprp/ipco and take the largest", () => {
    expect(dims("image/avif", avif(640, 480))).toEqual({ width: 640, height: 480 });
    expect(dims("image/heic", heic(640, 480))).toEqual({ width: 640, height: 480 });
  });

  test("a decoy ispe outside meta/iprp/ipco is ignored", () => {
    const free = concat(u32(8 + 20), "free", u32(20), "ispe", u32(0), u32(1), u32(1));
    const bytes = concat(avif(5000, 4000).slice(0, 24), free, avif(5000, 4000).slice(24));
    // `free` is a legal top-level sibling; the real ispe still wins and the decoy changes nothing.
    expect(dims("image/avif", bytes)).toEqual({ width: 5000, height: 4000 });
  });

  test("the bytes ispe inside mdat are not a box", () => {
    const decoy = concat(u32(8 + 16), "mdat", "ispe", u32(0), u32(1), u32(1));
    const bytes = concat(avif(300, 200), decoy);
    expect(dims("image/avif", bytes)).toEqual({ width: 300, height: 200 });
  });

  test("an avis sequence is as large as its biggest track, and a decoy ispe cannot hide it", () => {
    expect(dims("image/avif", avis(60000, 60000, { ispe: [1, 1] }))).toEqual({
      width: 60000,
      height: 60000,
    });
    expect(dims("image/avif", avis(640, 480))).toEqual({ width: 640, height: 480 });
    expect(dims("image/avif", avis(640, 480, { version: 1 }))).toEqual({ width: 640, height: 480 });
  });

  test("a sequence with a bigger ispe than its track reports the ispe", () => {
    expect(dims("image/avif", avis(10, 10, { ispe: [2000, 1000] }))).toEqual({
      width: 2000,
      height: 1000,
    });
  });

  test("a still avif does not read a moov it does not need", () => {
    const moov = concat(u32(8 + 8 + 84), "moov", u32(8 + 84), "trak", new Uint8Array(84));
    expect(dims("image/avif", concat(avif(300, 200), moov))).toEqual({ width: 300, height: 200 });
  });

  test("64-bit box sizes and run-to-end boxes are understood", () => {
    const base = avif(300, 200);
    const large = concat(u32(1), "free", u32(0), u32(16 + 4), [1, 2, 3, 4]);
    const toEnd = concat(u32(0), "mdat", [9, 9, 9]);
    expect(dims("image/avif", concat(base.slice(0, 24), large, base.slice(24), toEnd))).toEqual({
      width: 300,
      height: 200,
    });
  });

  test.each([
    ["no ftyp", concat(u32(8), "free")],
    ["an empty file", new Uint8Array(0)],
    ["a still without a meta box", concat(ftyp("avif", "avif"))],
    ["a meta without iprp", concat(ftyp("avif", "avif"), u32(12), "meta", u32(0))],
    ["a box shorter than its own header", concat(ftyp("avif"), u32(4), "free")],
    ["a box that overruns the file", concat(ftyp("avif"), u32(500), "meta")],
    ["a 64-bit size with a high word", concat(ftyp("avif"), u32(1), "free", u32(1), u32(16))],
    ["a 64-bit header cut short", concat(ftyp("avif"), u32(1), "free", u32(0))],
    ["trailing bytes too short for a box", concat(avif(3, 3), [0, 0, 0])],
    [
      "an ispe that is too short",
      concat(ftyp("avif"), box("meta", u32(0), box("iprp", box("ipco", box("ispe", u32(0)))))),
    ],
    [
      "an avis whose tkhd is too short",
      concat(
        ftyp("avis", "avis"),
        u32(8 + 8 + 8 + 10),
        "moov",
        u32(8 + 8 + 10),
        "trak",
        u32(8 + 10),
        "tkhd",
        new Uint8Array(10),
      ),
    ],
    ["an avis whose moov overruns", concat(ftyp("avis", "avis"), u32(900), "moov")],
    [
      "an avis whose trak overruns",
      concat(ftyp("avis", "avis"), u32(8 + 8), "moov", u32(900), "trak"),
    ],
    [
      "an avis whose trak is malformed",
      concat(ftyp("avis", "avis"), u32(8 + 8 + 4), "moov", u32(8 + 4), "trak", [0, 0, 0, 0]),
    ],
    [
      "an avif whose ipco holds a broken box",
      concat(
        ftyp("avif"),
        u32(8 + 4 + 8 + 8 + 4),
        "meta",
        u32(0),
        u32(8 + 8 + 4),
        "iprp",
        u32(8 + 4),
        "ipco",
        [0, 0, 0, 0],
      ),
    ],
    ["a mp4", mp4()],
  ])("%s has no dimensions", (_name, bytes) => {
    expect(dims("image/avif", bytes)).toBeUndefined();
  });

  test("too many boxes are refused", () => {
    const many = concat(
      ftyp("avif"),
      ...Array.from({ length: 5000 }, () => concat(u32(8), "free")),
    );
    expect(dims("image/avif", many)).toBeUndefined();
  });

  test("png is still a png", () => {
    expect(dims("image/png", png(3, 4))).toEqual({ width: 3, height: 4 });
  });
});

describe("byte views", () => {
  const parts = [
    new Uint8Array([1, 2, 3]),
    new Uint8Array(0),
    new Uint8Array([4]),
    new Uint8Array([5, 6]),
  ];

  test("a chunk view reads across chunks, empty chunks, and backwards", () => {
    const view = chunksView(parts);
    expect(view.length).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((i) => view.at(i))).toEqual([1, 2, 3, 4, 5, 6]);
    expect([5, 3, 0, 4, 2].map((i) => view.at(i))).toEqual([6, 4, 1, 5, 3]);
    expect(view.at(-1)).toBe(0);
    expect(view.at(6)).toBe(0);
  });

  test("a byte view returns 0 outside the bytes", () => {
    const view = bytesView(new Uint8Array([7]));
    expect([view.at(0), view.at(1), view.length]).toEqual([7, 0, 1]);
  });

  test("a view works anywhere bytes do", () => {
    expect(
      imageDimensions("image/png", chunksView([png(7, 9).slice(0, 10), png(7, 9).slice(10)])),
    ).toEqual({
      width: 7,
      height: 9,
    });
  });

  test("prefixOf joins at most `count` bytes", () => {
    expect([...prefixOf(parts, 4)]).toEqual([1, 2, 3, 4]);
    expect([...prefixOf(parts, 100)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...prefixOf([], 5)]).toEqual([]);
    expect([...prefixOf(parts, 0)]).toEqual([]);
  });
});
