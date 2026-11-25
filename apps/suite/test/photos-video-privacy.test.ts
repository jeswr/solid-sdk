// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  type ImageEncoder,
  preparePhoto,
  readVideoMetadata,
  stripVideoLocation,
  VideoLocationError,
} from "../src/apps/photos/lib/model";

const text = (value: string) => new TextEncoder().encode(value);
function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
function uint(value: number, width = 4) {
  const bytes = new Uint8Array(width);
  let rest = BigInt(value);
  for (let index = width - 1; index >= 0; index--) {
    bytes[index] = Number(rest & BigInt(255));
    rest >>= BigInt(8);
  }
  return bytes;
}
function box(type: string, ...parts: Uint8Array[]) {
  const payload = join(...parts);
  return join(
    uint(8 + payload.length),
    Uint8Array.from([...type].map((char) => char.charCodeAt(0))),
    payload,
  );
}
const full = (flags = 0, version = 0) => join(uint(version, 1), uint(flags, 3));
function xyz() {
  const value = text("+51.5074-000.1278/");
  return box("©xyz", uint(value.length, 2), uint(0, 2), value);
}
function header() {
  const bytes = new Uint8Array(100);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 3877243200);
  view.setUint32(12, 1000);
  view.setUint32(16, 2500);
  return box("mvhd", bytes);
}
const movie = (...parts: Uint8Array[]) => box("moov", header(), ...parts);
const metadata = { created: "2026-11-11T12:00:00.000Z", durationSeconds: 2.5 };
const KEY = "com.apple.quicktime.location.ISO6709";
const GPS = text("+51.5074-000.1278/");
const XMP_UUID = Uint8Array.of(
  0xbe,
  0x7a,
  0xcf,
  0xcb,
  0x97,
  0xa9,
  0x42,
  0xe8,
  0x9c,
  0x71,
  0x99,
  0x94,
  0x91,
  0xe3,
  0xaf,
  0xac,
);
function wideText(value: string, bigEndian: boolean, width = 2) {
  const bytes = new Uint8Array(value.length * width);
  for (let index = 0; index < value.length; index++)
    bytes[index * width + (bigEndian ? width - 1 : 0)] = value.charCodeAt(index);
  return bytes;
}
function exifGps(bigEndian: boolean, tag = 0x8825) {
  const tiff = new Uint8Array(32);
  const view = new DataView(tiff.buffer);
  tiff.set(text(bigEndian ? "MM" : "II"));
  view.setUint16(2, 42, !bigEndian);
  view.setUint32(4, 8, !bigEndian);
  view.setUint16(8, 1, !bigEndian);
  view.setUint16(10, tag, !bigEndian);
  view.setUint16(12, 4, !bigEndian);
  view.setUint32(14, 1, !bigEndian);
  view.setUint32(18, 26, !bigEndian);
  return join(text("Exif\0\0"), tiff);
}
function canonGpsIfd(bigEndian: boolean) {
  // CMT4 is a TIFF stream whose first directory is GPS itself (no GPS pointer tag).
  const bytes = new Uint8Array(110);
  const view = new DataView(bytes.buffer);
  const little = !bigEndian;
  bytes.set(text(bigEndian ? "MM" : "II"));
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 4, little);
  for (const [index, tag, type, count, offset] of [
    [0, 1, 2, 2, 0],
    [1, 2, 5, 3, 62],
    [2, 3, 2, 2, 0],
    [3, 4, 5, 3, 86],
  ]) {
    const start = 10 + (index as number) * 12;
    view.setUint16(start, tag as number, little);
    view.setUint16(start + 2, type as number, little);
    view.setUint32(start + 4, count as number, little);
    view.setUint32(start + 8, offset as number, little);
  }
  bytes[18] = 78;
  bytes[42] = 87; // N and W
  for (const [index, numerator, denominator] of [
    [0, 51, 1],
    [1, 30, 1],
    [2, 2664, 100],
    [3, 0, 1],
    [4, 7, 1],
    [5, 4008, 100],
  ]) {
    view.setUint32(62 + (index as number) * 8, numerator as number, little);
    view.setUint32(66 + (index as number) * 8, denominator as number, little);
  }
  return bytes;
}
function refusesUnchanged(bytes: Uint8Array<ArrayBuffer>) {
  const before = bytes.slice();
  expect(() => stripVideoLocation(bytes)).toThrow(VideoLocationError);
  expect(() => stripVideoLocation(bytes)).toThrow("metadata is unreadable");
  expect(bytes).toEqual(before);
}
function contains(bytes: Uint8Array, needle: Uint8Array) {
  return Buffer.from(bytes).includes(Buffer.from(needle));
}
function scrub(bytes: Uint8Array<ArrayBuffer>, ...secrets: Uint8Array[]) {
  for (const secret of secrets) expect(contains(bytes, secret)).toBe(true);
  const size = bytes.length;
  expect(stripVideoLocation(bytes)).toBe(bytes);
  expect(bytes.length).toBe(size);
  for (const secret of secrets) expect(contains(bytes, secret)).toBe(false);
  return bytes;
}
const AUDIO =
  "mp4a ac-3 ec-3 Opus fLaC alac lpcm sowt twos ipcm fpcm in24 in32 fl32 fl64 ulaw alaw".split(" ");
const VIDEO = [
  ..."avc1 avc3 hvc1 hev1 dvh1 dvhe mp4v av01 vp08 vp09 apcn apch apcs apco ap4h ap4x jpeg mjpa mjpb".split(
    " ",
  ),
  "raw ",
];
function sample(format = "avc1", children: Uint8Array[] = [], version = 0) {
  const prefix = new Uint8Array(
    format === "tmcd"
      ? children.length
        ? 26
        : 28
      : AUDIO.includes(format)
        ? 28 + (version === 1 ? 16 : version === 2 ? 36 : 0)
        : VIDEO.includes(format)
          ? 78
          : 8,
  );
  if (AUDIO.includes(format)) new DataView(prefix.buffer).setUint16(8, version);
  return box(format, prefix, ...children);
}
interface TrackOptions {
  handler?: string;
  handlerName?: Uint8Array;
  formats?: Uint8Array[];
  sizes?: number[];
  offsets?: number[];
  fixed?: number;
  compact?: number;
  co64?: boolean;
  mapping?: number[][];
  minfExtra?: Uint8Array[];
  tableExtra?: Uint8Array[];
  extra?: Uint8Array[];
  version?: number;
}
function track(id: number, options: TrackOptions = {}) {
  const {
    handler = "vide",
    handlerName = new Uint8Array(),
    formats = [sample()],
    sizes = [],
    offsets = [],
    fixed = 0,
    compact,
    co64 = false,
    mapping = offsets.map((_, index) => [index + 1, 1, 1]),
    minfExtra = [],
    tableExtra = [],
    extra = [],
    version = 0,
  } = options;
  const sizeData =
    compact === 4
      ? Uint8Array.from(
          sizes
            .filter((_, index) => index % 2 === 0)
            .map((size, index) => size * 16 + (sizes[index * 2 + 1] ?? 0)),
        )
      : join(...sizes.map((size) => uint(size, compact === 16 ? 2 : compact === 8 ? 1 : 4)));
  return box(
    "trak",
    box(
      "tkhd",
      full(0, version),
      new Uint8Array(version === 1 ? 16 : 8),
      uint(id),
      new Uint8Array(64),
    ),
    box(
      "mdia",
      box("mdhd", new Uint8Array(24)),
      box("hdlr", new Uint8Array(8), text(handler), new Uint8Array(12), handlerName),
      box(
        "minf",
        ...minfExtra,
        box(
          "stbl",
          box("stsd", full(), uint(formats.length), ...formats),
          compact === undefined
            ? box("stsz", full(), uint(fixed), uint(sizes.length), ...(fixed ? [] : [sizeData]))
            : box("stz2", full(), uint(0, 3), uint(compact, 1), uint(sizes.length), sizeData),
          box(
            co64 ? "co64" : "stco",
            full(),
            uint(offsets.length),
            ...offsets.map((offset) => uint(offset, co64 ? 8 : 4)),
          ),
          box(
            "stsc",
            full(),
            uint(mapping.length),
            ...mapping.map((entry) => join(...entry.map((value) => uint(value)))),
          ),
          ...tableExtra,
        ),
      ),
    ),
    ...extra,
  );
}
function staticFile(format = "mebx", options: TrackOptions = {}, after = false) {
  const media = join(text("VIDEO"), GPS, text("AUDIO"));
  const build = (base: number) =>
    movie(
      track(1, { sizes: [5], offsets: [base] }),
      track(2, {
        handler: "meta",
        formats: [sample(format)],
        sizes: [GPS.length],
        offsets: [base + 5],
        ...options,
      }),
      track(3, {
        handler: "soun",
        formats: [sample("mp4a")],
        sizes: [5],
        offsets: [base + 5 + GPS.length],
      }),
    );
  const moov = build(0);
  const base = after ? 8 : moov.length + 8;
  return {
    bytes: after ? join(box("mdat", media), build(base)) : join(build(base), box("mdat", media)),
    base,
    video: track(1, { sizes: [5], offsets: [base] }),
    audio: track(3, {
      handler: "soun",
      formats: [sample("mp4a")],
      sizes: [5],
      offsets: [base + 5 + GPS.length],
    }),
  };
}
function iloc(
  offset: number,
  length: number,
  version = 0,
  method = 0,
  reference = 0,
  width = 4,
  indexWidth = 0,
) {
  return box(
    "iloc",
    full(0, version),
    uint(width * 16 + width, 1),
    uint(width * 16 + indexWidth, 1),
    uint(1, version < 2 ? 2 : 4),
    uint(1, version < 2 ? 2 : 4),
    ...(version === 0 ? [] : [uint(method, 2)]),
    uint(reference, 2),
    uint(0, width),
    uint(1, 2),
    uint(0, version === 0 ? 0 : indexWidth),
    uint(offset, width),
    uint(length, width),
  );
}
function tfhd(id: number, flags: number, ...values: Uint8Array[]) {
  return box("tfhd", full(flags), uint(id), ...values);
}
function trun(count: number, flags: number, ...values: Uint8Array[]) {
  return box("trun", full(flags), uint(count), ...values);
}
function fragmented(mode: "moof" | "explicit" | "implicit" | "negative" | "trex" = "moof") {
  const init = movie(
    track(1),
    track(2, { handler: "meta", formats: [sample("mebx")] }),
    box("mvex", box("trex", full(), uint(2), uint(1), uint(1), uint(GPS.length), uint(0))),
  );
  const build = (base: number) =>
    box(
      "moof",
      box("mfhd", full(), uint(1)),
      box(
        "traf",
        tfhd(1, mode === "implicit" ? 0 : 0x020000),
        trun(1, 0x201, uint(base - init.length), uint(5)),
      ),
      box(
        "traf",
        tfhd(
          2,
          mode === "explicit" || mode === "negative"
            ? 1 | 16
            : mode === "implicit"
              ? 16
              : mode === "trex"
                ? 0x020000
                : 0x020000 | 16,
          ...(mode === "explicit"
            ? [uint(base + 5, 8)]
            : mode === "negative"
              ? [uint(base + 5 + GPS.length, 8)]
              : []),
          ...(mode === "trex" ? [] : [uint(GPS.length)]),
        ),
        trun(
          1,
          mode === "implicit" || mode === "explicit" ? 0 : 1,
          ...(mode === "implicit" || mode === "explicit"
            ? []
            : [uint(mode === "negative" ? 0x100000000 - GPS.length : base + 5 - init.length)]),
        ),
        box("Exif", exifGps(false)),
      ),
    );
  const base = init.length + build(0).length + 8;
  return { bytes: join(init, build(base), box("mdat", text("VIDEO"), GPS)), base };
}

describe("video allow-list privacy rebuild", () => {
  it("zeros every unreferenced static mdat byte across gaps and multiple payloads", () => {
    const first = box("mdat", GPS, text("VIDEO"), GPS, text("AUDIO"), GPS);
    const second = box("mdat", GPS, text("MORE"), GPS);
    const firstVideo = 8 + GPS.length;
    const secondVideo = first.length + 8 + GPS.length;
    const bytes = join(
      first,
      second,
      box("mdat", GPS),
      movie(
        track(1, {
          sizes: [4, 2, 3],
          offsets: [secondVideo, firstVideo, firstVideo + 2],
          co64: true,
        }),
        track(2, {
          handler: "soun",
          formats: [sample("mp4a")],
          sizes: [5],
          offsets: [firstVideo + 5 + GPS.length],
        }),
        track(3, { handler: "meta", sizes: [GPS.length], offsets: [8] }),
      ),
    );
    const zero = new Uint8Array(GPS.length);
    const expected = join(
      box("mdat", zero, text("VIDEO"), zero, text("AUDIO"), zero),
      box("mdat", zero, text("MORE"), zero),
      box("mdat", zero),
    );
    scrub(bytes, GPS);
    expect(bytes.subarray(0, expected.length)).toEqual(expected);
    const before = bytes.slice();
    expect(stripVideoLocation(bytes)).toEqual(before);
  });
  it("zeros fragment gaps alongside static samples and entirely unreferenced mdats", () => {
    const still = box("mdat", text("STILL"), GPS);
    const init = movie(
      track(1, { sizes: [5], offsets: [8] }),
      track(2, { handler: "soun", formats: [sample("mp4a")] }),
      track(3, { handler: "meta" }),
    );
    const build = (offset: number) =>
      box(
        "moof",
        box("traf", tfhd(1, 0x020010, uint(2)), trun(2, 1, uint(offset + GPS.length))),
        box("traf", tfhd(2, 0x020010, uint(5)), trun(1, 1, uint(offset + GPS.length * 2 + 4))),
        box("traf", tfhd(3, 0x020010, uint(GPS.length)), trun(1, 1, uint(offset + GPS.length + 4))),
      );
    const fragment = build(build(0).length + 8);
    const bytes = join(
      still,
      init,
      fragment,
      box("mdat", GPS, text("VID1"), GPS, text("AUDIO"), GPS),
      box("mdat", GPS),
    );
    scrub(bytes, GPS);
    const zero = new Uint8Array(GPS.length);
    expect(bytes.subarray(0, still.length)).toEqual(box("mdat", text("STILL"), zero));
    expect(bytes.subarray(still.length + init.length + fragment.length)).toEqual(
      join(box("mdat", zero, text("VID1"), zero, text("AUDIO"), zero), box("mdat", zero)),
    );
  });
  it.each([
    "alis",
    "url ",
    "urn ",
  ])("preserves self-contained %s references and clears trailing payload bytes", (type) => {
    for (const flags of [1, 3]) {
      const reference = box(type, full(flags), GPS, Uint8Array.of(0));
      const bytes = movie(
        track(1, { minfExtra: [box("dinf", box("dref", full(), uint(1), reference))] }),
      );
      scrub(bytes, GPS);
      expect(contains(bytes, box(type, full(flags), new Uint8Array(GPS.length + 1)))).toBe(true);
      const before = bytes.slice();
      expect(stripVideoLocation(bytes)).toEqual(before);
    }
  });
  it.each(["alis", "url ", "urn "])("refuses non-self-contained %s references", (type) => {
    for (const entry of [
      box(type, full(), text("file:///"), GPS),
      box(type, full(2), GPS),
      box(type, full(1, 1)),
      box(type, new Uint8Array(3)),
    ])
      refusesUnchanged(
        movie(track(1, { minfExtra: [box("dinf", box("dref", full(), uint(1), entry))] })),
      );
  });
  it("resolves huge defaulted fragment sample counts without iterating through samples", () => {
    const init = movie(
      track(1),
      box("mvex", box("trex", full(), uint(1), uint(1), uint(0), uint(0), uint(0))),
    );
    const runs = Array.from({ length: 64 }, () => trun(0xffffffff, 0));
    const bytes = join(
      box("mdat", GPS),
      init,
      box("moof", box("traf", tfhd(1, 1, uint(8, 8)), ...runs)),
    );
    scrub(bytes, GPS);
    expect(bytes.subarray(8, 8 + GPS.length)).toEqual(new Uint8Array(GPS.length));
  });
  it("bounds fragment per-sample tables even when sample sizes are defaulted", () => {
    const init = movie(track(1));
    for (const flags of [0x100, 0x200, 0x400, 0x800, 0xf00]) {
      const stride = flags === 0xf00 ? 16 : 4;
      const build = (run: Uint8Array) =>
        join(
          box("mdat", new Uint8Array(1)),
          init,
          box("moof", box("traf", tfhd(1, 1 | 16, uint(8, 8), uint(0)), run)),
        );
      refusesUnchanged(build(trun(2, flags, new Uint8Array(stride * 2 - 1))));
      refusesUnchanged(build(trun(0xffffffff, flags)));
      const valid = build(trun(2, flags, new Uint8Array(stride * 2)));
      const before = valid.slice();
      expect(stripVideoLocation(valid)).toEqual(before);
    }
  });
  it("accepts FFmpeg timecode entries and neutralises their optional reel name atom", () => {
    const prefix = join(
      uint(0),
      uint(1),
      uint(0),
      uint(0),
      uint(2500),
      uint(100),
      uint(25, 1),
      uint(0, 1),
    );
    const reelName = box("name", uint(GPS.length, 2), uint(0, 2), GPS);
    const entry = box("tmcd", prefix, reelName);
    const bytes = movie(track(1), track(2, { handler: "tmcd", formats: [entry] }));
    scrub(bytes, GPS);
    expect(
      contains(bytes, box("tmcd", prefix, box("free", new Uint8Array(reelName.length - 8)))),
    ).toBe(true);
    for (const tail of [new Uint8Array(), new Uint8Array(2)]) {
      const plain = movie(track(2, { handler: "tmcd", formats: [box("tmcd", prefix, tail)] }));
      const before = plain.slice();
      expect(stripVideoLocation(plain)).toEqual(before);
    }
    refusesUnchanged(movie(track(2, { formats: [box("tmcd", prefix, Uint8Array.of(0, 1))] })));
  });
  it("zeros handler names and visual compressor names while keeping their fixed fields", () => {
    for (const format of VIDEO) {
      const visual = new Uint8Array(78).fill(7);
      visual.fill(0, 42, 74);
      visual[42] = GPS.length;
      visual.set(GPS, 43);
      const bytes = movie(
        track(1, {
          handlerName: join(GPS, Uint8Array.of(0)),
          formats: [box(format, visual, box("avcC", Uint8Array.of(1, 2)))],
        }),
      );
      const before = bytes.slice();
      const handlerStart = Buffer.from(bytes).indexOf("hdlr") + 4;
      const visualStart = Buffer.from(bytes).indexOf(format) + 4;
      const expected = before.slice();
      expected.fill(0, handlerStart + 24, handlerStart + 24 + GPS.length + 1);
      expected.fill(0, visualStart + 42, visualStart + 74);
      scrub(bytes, GPS);
      expect(bytes).toEqual(expected);
      expect(stripVideoLocation(bytes)).toEqual(expected);
    }
    const truncatedHandler = movie(track(1));
    const handlerType = Buffer.from(truncatedHandler).indexOf("hdlr");
    // Preserve the atom extent but turn its reserved bytes into a sibling atom.
    new DataView(truncatedHandler.buffer).setUint32(handlerType - 4, 24);
    truncatedHandler.set(box("free"), handlerType + 20);
    refusesUnchanged(truncatedHandler);
  });
  it.each(["stbl", "traf"])("neutralises unknown sample grouping hints in %s", (parent) => {
    const groups = [
      box("sgpd", full(0, 1), text("gps "), uint(GPS.length), uint(1), GPS),
      box("sbgp", full(), text("gps "), uint(1), uint(1), uint(1)),
    ];
    const bytes =
      parent === "stbl"
        ? movie(track(1, { tableExtra: groups }))
        : join(movie(track(1)), box("moof", box("traf", tfhd(1, 0x010000), ...groups)));
    scrub(bytes, GPS, text("gps "));
    for (const group of groups)
      expect(contains(bytes, box("free", new Uint8Array(group.length - 8)))).toBe(true);
  });
  it("preserves all well-known sample grouping types", () => {
    for (const group of ["roll", "prol", "rap ", "sync", "tele", "alst", "tscl", "stsa", "sap "]) {
      const groups = [
        box("sgpd", full(0, 1), text(group), uint(2), uint(1), uint(1, 2)),
        box("sbgp", full(), text(group), uint(1), uint(1), uint(1)),
      ];
      const bytes = join(
        movie(track(1, { tableExtra: groups })),
        box("moof", box("traf", tfhd(1, 0x010000), ...groups)),
      );
      const before = bytes.slice();
      expect(stripVideoLocation(bytes)).toEqual(before);
    }
  });
  it("removes every previous XMP namespace/prefix/encoding fixture", () => {
    for (const uri of [
      "http://ns.adobe.com/exif/1.0/",
      "http://ns.adobe.com/tiff/1.0/",
      "http://cipa.jp/exif/1.0/",
    ]) {
      for (const xml of [
        `<r xmlns:e="${uri}"><e:GPSIFDPointer>26</e:GPSIFDPointer></r>`,
        `<r xmlns:alias='${uri}' alias:GPSAltitude='120'/>`,
        `<GPSLatitude xmlns="${uri}">51,30N</GPSLatitude>`,
        `<gpsinfo xmlns="${uri.toUpperCase()}">26</gpsinfo>`,
      ]) {
        for (const packet of [text(xml), wideText(xml, false), wideText(xml, true)])
          scrub(movie(box("udta", xyz(), box("XMP_", packet))), packet, GPS);
      }
    }
    for (const name of ["GPSLatitude", "GPSLongitude", "GPSPosition", "GPSCoordinates"])
      for (const xml of [`<${name}>here</${name}>`, `<r custom:${name.toLowerCase()}='here'/>`])
        for (const packet of [text(xml), wideText(xml, false), wideText(xml, true)])
          scrub(movie(box("udta", box("XMP_", packet))), packet);
    for (const xml of [
      "<exif:GPSLatitude>51,30N</exif:GPSLatitude>",
      '<rdf:Description exif:GPSLongitude="0,7W"/>',
      "<tiff:GPSInfo>123</tiff:GPSInfo>",
      "<exif:GPSIFDPointer>123</exif:GPSIFDPointer>",
      "<tiff:GPSIFD>123</tiff:GPSIFD>",
      '<rdf:Description exif:GPSLatitude="51,30N"/>',
    ]) {
      for (const packet of [
        text(xml),
        ...[2, 4].flatMap((width) => [wideText(xml, false, width), wideText(xml, true, width)]),
      ]) {
        for (const bytes of [
          movie(box("udta", xyz(), box("XMP_", packet))),
          join(movie(box("udta", xyz())), box("uuid", XMP_UUID, packet)),
          join(movie(), box("XMP_", packet)),
        ])
          scrub(bytes, packet);
      }
    }
  });
  it("removes unknown leaves, binary GPS IFDs, DD/DDMM/DDMMSS text, and padded comments", () => {
    const payloads = [
      text('<r xmlns:e="http://cipa.jp/exif/1.0/" e:GPSAltitude="120"/>'),
      exifGps(false),
      exifGps(true),
      text("Recorded at +51.5074-000.1278/"),
      wideText("Recorded at -12+034+100/", false),
      wideText("Recorded at +12-034/", true),
      text("+5130.44-00007.67/"),
      text("+513026.4-0000740.2/"),
    ];
    for (const payload of payloads)
      for (const leaf of [
        movie(box("udta", box("abcd", payload))),
        movie(track(1, { extra: [box("abcd", payload)] })),
        box("trak", track(1, { extra: [box("abcd", payload)] }).subarray(8)),
        box("udta", box("abcd", payload)),
        box("meta", full(), box("abcd", payload)),
        box("ilst", box("abcd", payload)),
        box("xml ", full(), payload),
        box("uuid", new Uint8Array(16), payload),
      ])
        scrub(join(movie(box("udta", xyz())), leaf), payload, GPS);
    for (const type of ["desc", "name", "©cmt"])
      scrub(movie(box("udta", box(type, new Uint8Array(10), GPS, new Uint8Array(40)))), GPS);
    for (const bigEndian of [false, true]) {
      const gps = canonGpsIfd(bigEndian);
      scrub(
        movie(
          box("uuid", Buffer.from("85c0b687820f11e08111f4ce462b6a48", "hex"), box("CMT4", gps)),
        ),
        gps,
      );
    }
  });
  it("zero-fills all padding and vendor boxes, including free XMP GPS", () => {
    for (const type of ["free", "skip", "wide", "uuid"])
      for (const marker of ["GPS", "freeGPS", "<exif:GPSLatitude>+12-034/</exif:GPSLatitude>"]) {
        const bytes = box(type, text(marker));
        const beforeSize = bytes.slice(0, 4);
        scrub(bytes, text(marker));
        expect(bytes.slice(0, 4)).toEqual(beforeSize);
        expect(bytes.subarray(8).every((byte) => byte === 0)).toBe(true);
        expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe(
          type === "uuid" ? "free" : type,
        );
      }
  });
  it("removes ordinary titles, all Apple location keys, and both meta header forms", () => {
    for (const key of [
      KEY,
      ...["name", "accuracy.horizontal", "body", "role", "custom"].map(
        (suffix) => `com.apple.quicktime.location.${suffix}`,
      ),
    ])
      for (const payload of [text(key), wideText(key, false), wideText(key, true)])
        for (const flags of [new Uint8Array(), full()]) {
          const bytes = movie(
            box(
              "meta",
              flags,
              box("hdlr", new Uint8Array(24)),
              box("keys", payload),
              box("ilst", xyz()),
            ),
          );
          expect(readVideoMetadata(bytes).location).toBeDefined();
          scrub(bytes, payload, GPS);
          expect(readVideoMetadata(bytes)).toEqual(metadata);
        }
    scrub(movie(box("udta", box("name", text("+12-034 Remix")))), text("+12-034 Remix"));
    for (const bytes of [box("keys", text(KEY)), box("uuid", new Uint8Array(16), text(KEY))])
      scrub(bytes, text(KEY));
  });
  it("removes ordinary metadata too and keeps codec bitstreams opaque", () => {
    const opaque = join(text("<GPSLatitude>+51-000/</GPSLatitude>"), exifGps(false), text(KEY));
    const mdat = box("mdat", opaque, box("udta", xyz()), box("XMP_", text("exif:GPSLatitude")));
    const bytes = join(
      mdat,
      movie(
        track(1, { sizes: [mdat.length - 8], offsets: [8] }),
        box(
          "udta",
          box("abcd", exifGps(false, 0x010f), exifGps(true, 0x010f)),
          box(
            "XMP_",
            text('<r xmlns:e="http://ns.adobe.com/exif/1.0/"><e:Make>Camera</e:Make></r>'),
          ),
          box(
            "xml ",
            text('<custom:GPSOther xmlns:custom="https://example.org/">x</custom:GPSOther>'),
          ),
          box("abcd", Uint8Array.of(73)),
          box("abcd"),
          box("abcd", text("x".repeat(16_385))),
          new Uint8Array(12),
        ),
      ),
      box("uuid", XMP_UUID, text("<tiff:Make>Camera</tiff:Make>")),
      box("uuid", new Uint8Array(16), text("exif:GPSLatitude")),
      box("uuid", new Uint8Array(3)),
    );
    stripVideoLocation(bytes);
    expect(bytes.slice(0, mdat.length)).toEqual(mdat);
    expect(contains(bytes.subarray(mdat.length), text("Camera"))).toBe(false);
  });
  it.each([
    "mebx",
    "gpmd",
    "djmd",
    "rtmd",
    "gps ",
    "zzzz",
    "camm",
  ])("removes %s samples from mdat and preserves video/audio, including moov after mdat", (format) => {
    for (const after of [false, true]) {
      const { bytes, base, video, audio } = staticFile(format, {}, after);
      scrub(bytes, GPS);
      expect(contains(bytes, video)).toBe(true);
      expect(contains(bytes, audio)).toBe(true);
      expect(bytes.slice(base, base + 5)).toEqual(text("VIDEO"));
      expect(bytes.slice(base + 5, base + 5 + GPS.length)).toEqual(new Uint8Array(GPS.length));
      expect(bytes.slice(base + 5 + GPS.length, base + 10 + GPS.length)).toEqual(text("AUDIO"));
      expect(contains(bytes, text(format))).toBe(false);
      expect(stripVideoLocation(bytes)).toBe(bytes);
    }
  });
  it.each([
    "meta",
    "text",
    "sbtl",
    "djmd",
    "rtmd",
    "gps ",
  ])("removes %s handlers even with an allowed codec", (handler) => {
    const { bytes } = staticFile("avc1", { handler });
    scrub(bytes, GPS);
  });
  it("removes a disallowed sample entry even from a vide track, and drops tref", () => {
    scrub(staticFile("mebx", { handler: "vide", formats: [sample(), sample("mebx")] }).bytes, GPS);
    const bytes = movie(track(1, { extra: [box("tref", box("cdsc", uint(2)))] }));
    scrub(bytes, text("cdsc"));
    expect(contains(bytes, text("tref"))).toBe(false);
  });
  it("preserves every allowed AV sample entry/config and scrubs arbitrary children and sinf", () => {
    const configs =
      "avcC hvcC dvcC dvvC av1C vpcC esds dOps dfLa alac dac3 dec3 btrt pasp colr clap fiel gama chan mdcv clli CoLL SmDm"
        .split(" ")
        .map((type) => box(type, Uint8Array.of(1, 2, 3)));
    configs.push(
      box(
        "wave",
        box("frma", text("mp4a")),
        box("esds", new Uint8Array(4)),
        box("enda", uint(1, 2)),
        box("\0\0\0\0"),
      ),
    );
    for (const format of [...VIDEO, ...AUDIO, "tmcd"]) {
      const entry = sample(format, configs);
      const bytes = movie(track(1, { formats: [entry] }));
      const before = bytes.slice();
      expect(stripVideoLocation(bytes)).toEqual(before);
      const infected = movie(
        track(1, {
          formats: [
            sample(format, [
              ...configs,
              box("sinf", box("schi", box("uuid", GPS))),
              box("uuid", exifGps(false)),
            ]),
          ],
        }),
      );
      scrub(infected, GPS, exifGps(false));
      for (const config of configs) expect(contains(infected, config)).toBe(true);
    }
    for (const version of [1, 2]) {
      const bytes = movie(
        track(1, { handler: "soun", formats: [sample("mp4a", configs, version)], version: 1 }),
      );
      const before = bytes.slice();
      expect(stripVideoLocation(bytes)).toEqual(before);
    }
  });
  it("preserves the allowed structural boxes and drops misplaced ones", () => {
    const leaf = (type: string) =>
      box(type, uint(0), ...(["sbgp", "sgpd"].includes(type) ? [text("roll"), uint(0)] : []));
    const bytes = join(
      leaf("ftyp"),
      leaf("styp"),
      movie(
        track(1, {
          extra: [box("edts", leaf("elst"))],
          tableExtra: "stts ctts cslg stss stps stsh sdtp sbgp sgpd saiz saio subs"
            .split(" ")
            .map(leaf),
        }),
        box("mvex", leaf("mehd"), leaf("trep")),
      ),
      box("mfra", leaf("tfra"), leaf("mfro")),
      leaf("sidx"),
    );
    const before = bytes.slice();
    expect(stripVideoLocation(bytes)).toEqual(before);
    scrub(movie(box("mdat", GPS), box("hdlr", GPS)), GPS);
    // All the minf alternatives, data references and gmhd children are retained.
    const structure = movie(
      track(1, {
        minfExtra: [
          ...["vmhd", "smhd", "nmhd"].map(leaf),
          box("gmhd", leaf("gmin"), leaf("tmcd")),
          box("dinf", box("dref", full(), uint(2), box("url ", full(1)), box("urn ", full(1)))),
        ],
      }),
    );
    const structureBefore = structure.slice();
    expect(stripVideoLocation(structure)).toEqual(structureBefore);
  });
  it.each([
    "moof",
    "explicit",
    "implicit",
    "negative",
    "trex",
  ] as const)("zeros removed fragment samples using %s offsets/defaults", (mode) => {
    const { bytes, base } = fragmented(mode);
    const trafStart = Buffer.from(bytes).indexOf("traf") - 4;
    const trafSize = new DataView(bytes.buffer).getUint32(trafStart);
    const videoFragment = bytes.slice(trafStart, trafStart + trafSize);
    scrub(bytes, GPS, exifGps(false));
    expect(contains(bytes, videoFragment)).toBe(true);
    expect(contains(bytes, track(1))).toBe(true);
    expect(bytes.slice(base, base + 5)).toEqual(text("VIDEO"));
    expect(bytes.slice(base + 5)).toEqual(new Uint8Array(GPS.length));
    expect(contains(bytes, text("Exif"))).toBe(false);
  });
  it("resolves multiple fragment runs, per-sample fields and defaults", () => {
    const init = movie(track(1), track(2, { handler: "meta", formats: [sample("mebx")] }));
    const build = (base: number) =>
      box(
        "moof",
        box(
          "traf",
          tfhd(2, 0x020000 | 2 | 8 | 32, uint(1), uint(1), uint(0)),
          trun(1, 0xf05, uint(base - init.length), uint(0), uint(1), uint(3), uint(0), uint(0)),
          trun(1, 0x200, uint(GPS.length - 3)),
        ),
      );
    const base = init.length + build(0).length + 8;
    scrub(join(init, build(base), box("mdat", GPS)), GPS);
  });
  it.each([0, 1, 2])("erases file-backed iloc v%s extents before dropping meta", (version) => {
    for (const width of [4, 8]) {
      const build = (offset: number) =>
        box(
          "meta",
          full(),
          iloc(offset, exifGps(false).length, version, 0, 0, width, version ? 2 : 0),
        );
      const base = build(0).length + 8;
      const bytes = join(build(base), box("mdat", exifGps(false)));
      scrub(bytes, exifGps(false));
      expect(bytes.slice(base)).toEqual(new Uint8Array(exifGps(false).length));
    }
  });
  it("finds meta inside removed containers and handles idat/item/external references", () => {
    const build = (base: number) => movie(box("udta", box("meta", full(), iloc(base, GPS.length))));
    const base = build(0).length + 8;
    scrub(join(build(base), box("mdat", GPS)), GPS);
    for (const [method, reference] of [
      [1, 0],
      [2, 0],
    ])
      scrub(box("meta", full(), iloc(999999, 10, 1, method, reference), box("idat", GPS)), GPS);
    // Zero-width base/offset/index and empty item tables are legal when not file-backed.
    stripVideoLocation(box("meta", full(), iloc(0, 0, 1, 1, 0, 0)));
    stripVideoLocation(box("meta", full(), box("iloc", full(), uint(0, 2), uint(0, 2))));
  });
  it("bounds iloc versions, widths, extents, integer precision and overlap with AV", () => {
    for (const bad of [
      iloc(0, 1, 3),
      iloc(0, 1, 1, 3),
      iloc(0, 1, 1, 0, 0, 9),
      iloc(999999, 10),
      iloc(0, 0),
      iloc(Number.MAX_SAFE_INTEGER, 1, 0, 0, 0, 8),
      iloc(0, 1).slice(0, -1),
      box("iloc", full(), uint(0, 2), uint(65535, 2)),
      join(iloc(0, 1), Uint8Array.of(1)),
    ]) {
      // Repair the leaf size for truncated/overlong cases so the field parser is exercised.
      new DataView(bad.buffer).setUint32(0, bad.length);
      refusesUnchanged(box("meta", full(), bad));
    }
    const { bytes, base } = staticFile();
    const meta = box("meta", full(), iloc(base, 1));
    refusesUnchanged(join(bytes, meta));
  });
  it("reads stsz fixed/variable sizes, stz2 4/8/16-bit sizes and co64 chunks", () => {
    for (const compact of [undefined, 4, 8, 16])
      for (const co64 of [false, true]) {
        const sizes = [2, 3, 4];
        const options: TrackOptions = {
          handler: "meta",
          formats: [sample("gpmd")],
          sizes,
          offsets: [8, 10, 13],
          mapping: [[1, 1, 1]],
          co64,
          ...(compact === undefined ? {} : { compact }),
        };
        const bytes = join(box("mdat", text("GPS123456")), movie(track(1, options)));
        scrub(bytes, text("GPS123456"));
        expect(bytes.slice(8, 17)).toEqual(new Uint8Array(9));
      }
    const bytes = join(
      box("mdat", GPS),
      movie(
        track(1, {
          handler: "meta",
          formats: [sample("gpmd")],
          sizes: [GPS.length],
          fixed: GPS.length,
          offsets: [8],
        }),
      ),
    );
    scrub(bytes, GPS);
  });
  it("resolves changing stsc mappings and accepts iPhone MOV orientation tracks", () => {
    const bytes = join(
      box("mdat", text("GPS123456")),
      movie(
        track(1, {
          handler: "meta",
          formats: [sample("gpmd")],
          sizes: [2, 3, 4],
          offsets: [8, 10],
          mapping: [
            [1, 1, 1],
            [2, 2, 1],
          ],
        }),
      ),
    );
    scrub(bytes, text("GPS123456"));
    const { bytes: mov, base, video, audio } = staticFile("mebx");
    // An orientation-only mebx sample is removed just like a GPS-bearing mebx sample.
    mov.fill(7, base + 5, base + 5 + GPS.length);
    stripVideoLocation(mov);
    expect(contains(mov, text("mebx"))).toBe(false);
    expect(mov.slice(base + 5, base + 5 + GPS.length)).toEqual(new Uint8Array(GPS.length));
    expect(contains(mov, video)).toBe(true);
    expect(contains(mov, audio)).toBe(true);
  });
  it("handles empty runs, discarded fragments, and item extents without damaging retained structure", () => {
    const init = movie(track(1));
    stripVideoLocation(join(init, box("moof", box("traf", tfhd(1, 0x010000), trun(0, 0)))));
    const build = (base: number) =>
      movie(
        track(1),
        box(
          "udta",
          box("moof", box("traf", tfhd(1, 1 | 16, uint(base, 8), uint(GPS.length)), trun(1, 0))),
        ),
      );
    const base = build(0).length + 8;
    scrub(join(build(base), box("mdat", GPS)), GPS);
    refusesUnchanged(join(box("ftyp", text("isom0000")), box("meta", full(), iloc(0, 1))));
    const removed = staticFile();
    scrub(join(removed.bytes, box("meta", full(), iloc(removed.base + 5, GPS.length))), GPS);
    const file = join(
      box("mdat", text("VIDEO"), GPS),
      movie(track(1, { sizes: [5], offsets: [8] })),
      box("meta", full(), iloc(13, GPS.length)),
    );
    scrub(file, GPS);
    expect(file.slice(8, 13)).toEqual(text("VIDEO"));
    const front = join(
      box("mdat", GPS, text("VIDEO")),
      movie(track(1, { sizes: [5], offsets: [8 + GPS.length] })),
      box("meta", full(), iloc(8, GPS.length)),
    );
    scrub(front, GPS);
    expect(front.slice(8 + GPS.length, 13 + GPS.length)).toEqual(text("VIDEO"));
  });
  it("finds item extents inside discarded metadata and protection containers", () => {
    for (const wrapper of ["meco", "sinf", "schi"]) {
      const build = (offset: number) => box(wrapper, box("meta", full(), iloc(offset, GPS.length)));
      const base = build(0).length + 8;
      scrub(join(build(base), box("mdat", GPS)), GPS);
    }
  });
  it("erases multiple item extents and scrubs unknown wave children", () => {
    const bytes = join(box("mdat", GPS), box("meta", full(), iloc(11, GPS.length - 3), iloc(8, 3)));
    scrub(bytes, GPS);
    expect(bytes.slice(8, 8 + GPS.length)).toEqual(new Uint8Array(GPS.length));
    const wave = movie(
      track(1, {
        formats: [
          sample("mp4a", [
            box("wave", box("frma", text("mp4a")), box("sinf", box("schi", box("uuid", GPS)))),
          ]),
        ],
      }),
    );
    scrub(wave, GPS);
    expect(contains(wave, box("frma", text("mp4a")))).toBe(true);
  });
  it("resolves moof-relative iloc offsets and explicit local/external item references", () => {
    const preface = movie();
    const build = (offset: number) => box("moof", box("meta", full(), iloc(offset, GPS.length)));
    const relative = build(0).length + 8;
    scrub(join(preface, build(relative), box("mdat", GPS)), GPS);
    for (const type of ["url ", "urn "]) {
      const refs = box("dinf", box("dref", full(), uint(1), box(type, full(1))));
      scrub(
        join(
          box("mdat", GPS),
          box("meta", full(), refs, iloc(8, GPS.length, 1, 0, 1), iloc(8, GPS.length, 1, 0, 1)),
        ),
        GPS,
      );
      scrub(
        box(
          "meta",
          full(),
          box("dinf", box("dref", full(), uint(1), box(type, full(), text("remote.mp4")))),
          iloc(999999, 10, 1, 0, 1),
          box("idat", GPS),
        ),
        GPS,
      );
    }
    refusesUnchanged(box("meta", full(), iloc(8, 1, 0, 0, 1)));
    refusesUnchanged(iloc(8, 1, 0, 0, 1));
    for (const [entry, reference] of [
      [box("url ", full(1)), 2],
      [box("abcd", full()), 1],
      [box("url ", full(0, 1)), 1],
    ] as const) {
      refusesUnchanged(
        box(
          "meta",
          full(),
          box("dinf", box("dref", full(), uint(1), entry)),
          iloc(8, 1, 0, 0, reference),
        ),
      );
    }
  });
  it("refuses retained fragment data whose implicit base would change after removal", () => {
    const init = movie(track(1), track(2, { handler: "meta", formats: [sample("mebx")] }));
    const build = (base: number, explicit: boolean) =>
      box(
        "moof",
        box("traf", tfhd(2, 1 | 16, uint(base, 8), uint(GPS.length)), trun(1, 0)),
        box(
          "traf",
          tfhd(
            1,
            explicit ? 1 | 16 : 16,
            ...(explicit ? [uint(base + GPS.length, 8)] : []),
            uint(5),
          ),
          trun(1, 0),
        ),
      );
    const base = init.length + build(0, false).length + 8;
    refusesUnchanged(join(init, build(base, false), box("mdat", GPS, text("VIDEO"))));
    const explicitBase = init.length + build(0, true).length + 8;
    const file = join(init, build(explicitBase, true), box("mdat", GPS, text("VIDEO")));
    scrub(file, GPS);
    expect(file.slice(-5)).toEqual(text("VIDEO"));
  });
  it("refuses corrupt chunk offsets, sizes and mappings without partial mutation", () => {
    for (const options of [
      { offsets: [0] },
      { offsets: [999999] },
      { offsets: [1], co64: true },
      { sizes: [1, 2] },
      { mapping: [[2, 1, 1]] },
      { mapping: [[1, 0, 1]] },
      { mapping: [[1, 1, 0]] },
      { mapping: [[1, 1, 2]] },
      { mapping: [] },
      { mapping: [[1, 2, 1]] },
      {
        mapping: [
          [1, 1, 1],
          [1, 1, 1],
        ],
      },
      { offsets: [] },
      { compact: 12 },
      { fixed: 999999 },
    ])
      refusesUnchanged(staticFile("mebx", options).bytes);
    const overlap = staticFile("mebx", { offsets: [8] }, true);
    refusesUnchanged(overlap.bytes);
    refusesUnchanged(movie(track(1), track(1)));
    refusesUnchanged(movie(track(0)));
    refusesUnchanged(movie(track(1, { version: 2 })));
    refusesUnchanged(movie(track(1, { formats: [sample("mp4a", [], 3)] })));
    refusesUnchanged(movie(box("trak", box("mdia"))));
  });
  it("refuses fragments whose references, defaults or bounds cannot be resolved", () => {
    const init = movie(track(1));
    for (const traf of [
      box("traf"),
      box("traf", tfhd(2, 0)),
      box("traf", tfhd(1, 0x4)),
      box("traf", tfhd(1, 2, uint(2))),
      box("traf", tfhd(1, 1, uint(Number.MAX_SAFE_INTEGER + 1, 8))),
      box("traf", tfhd(1, 0), trun(1, 0)),
      box("traf", tfhd(1, 0), trun(1, 0x200, uint(10))),
      box("traf", tfhd(1, 0x010000), trun(1, 0x200, uint(1))),
      box("traf", tfhd(1, 0), trun(0, 0x2)),
      box("traf", tfhd(1, 0), box("trun", full(0, 2), uint(0))),
      box("traf", box("tfhd", full(0, 1), uint(1))),
      box("traf", tfhd(1, 0), trun(999999, 0)),
    ])
      refusesUnchanged(join(init, box("moof", traf), box("mdat", GPS)));
    const badTrex = box("trex", full(), uint(1), uint(1), uint(1), uint(1), uint(0));
    refusesUnchanged(movie(track(1), box("mvex", badTrex, badTrex)));
    // A legal duration-is-empty fragment carries no sample ranges.
    stripVideoLocation(join(init, box("moof", box("traf", tfhd(1, 0x010000)))));
  });
  it("retains allowed fragment auxiliaries but neutralises Exif, senc and arbitrary children", () => {
    const init = movie(track(1));
    const kept = "tfdt sbgp sgpd saiz saio subs"
      .split(" ")
      .map((type) =>
        box(type, uint(0), ...(["sbgp", "sgpd"].includes(type) ? [text("roll"), uint(0)] : [])),
      );
    const bytes = join(
      init,
      box(
        "moof",
        box("traf", tfhd(1, 0x010000), ...kept, box("Exif", exifGps(true)), box("senc", GPS)),
      ),
    );
    scrub(bytes, GPS, exifGps(true));
    for (const value of kept) expect(contains(bytes, value)).toBe(true);
  });
  it("supports ArrayBuffer, byte subviews, extended/to-end sizes and zero padding", () => {
    const source = movie(box("udta", xyz(), new Uint8Array(4)));
    expect(readVideoMetadata(source)).toMatchObject(metadata);
    expect(readVideoMetadata(movie(track(1)))).toEqual(metadata);
    const buffer = source.buffer;
    expect(stripVideoLocation(buffer).buffer).toBe(buffer);
    const padded = join(Uint8Array.of(9), movie(box("udta", xyz())), Uint8Array.of(8));
    const subview = padded.subarray(1, -1);
    expect(stripVideoLocation(subview)).toBe(subview);
    expect(padded[0]).toBe(9);
    expect(padded.at(-1)).toBe(8);
    expect(readVideoMetadata(subview)).toEqual(metadata);
    const large = join(uint(1), text("uuid"), uint(16 + GPS.length, 8), GPS);
    scrub(large, GPS);
    const toEnd = join(uint(0), text("mdat"), GPS);
    expect(readVideoMetadata(toEnd)).toEqual({});
    expect(stripVideoLocation(toEnd)).toEqual(
      join(uint(0), text("mdat"), new Uint8Array(GPS.length)),
    );
    expect(stripVideoLocation(new Uint8Array())).toEqual(new Uint8Array());
  });
  it("rejects malformed structures, ambiguous zero terminators and unreadable WebM", () => {
    for (const tail of [xyz(), box("free"), Uint8Array.of(0, 0, 0, 1)])
      refusesUnchanged(movie(box("udta", new Uint8Array(4), tail)));
    for (const bad of [
      join(movie(), new Uint8Array(4)),
      movie(box("udta", xyz(), Uint8Array.of(0, 0, 0, 1))),
      movie(box("stsd", new Uint8Array(7))),
      box("stsd", full(), uint(1)),
      box("stsd", full(1), uint(0)),
      box("stsd", full(), uint(1), box("avc1", new Uint8Array(2))),
      Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0),
    ])
      refusesUnchanged(bad);
    const frees = new Uint8Array(100_001 * 8);
    for (let offset = 0; offset < frees.length; offset += 8) frees.set(box("free"), offset);
    for (const bytes of [frees, movie(frees)]) {
      expect(readVideoMetadata(bytes)).toEqual({});
      refusesUnchanged(bytes);
    }
    const bytes = join(movie(), box("mdat", frees, text("invalid boxes")));
    expect(stripVideoLocation(bytes)).toBe(bytes);
  });
  it("reads a file once and scrubs the same buffer during MP4/MOV upload preparation", async () => {
    for (const type of ["video/mp4", "video/quicktime"]) {
      const bytes = movie(box("udta", xyz()));
      const original = new Blob([bytes], { type });
      const read = vi.spyOn(original, "arrayBuffer").mockResolvedValue(bytes.buffer);
      const encoder: ImageEncoder = {
        dimensions: async () => ({ width: 1920, height: 1080 }),
        thumbnail: async () => new Blob(["thumbnail"], { type: "image/webp" }),
        stripLocation: async (blob) =>
          new Blob([stripVideoLocation(await blob.arrayBuffer())], { type }),
      };
      const prepared = await preparePhoto(
        "https://video.example/",
        { id: "clip", name: "Clip", original, stripLocation: true },
        encoder,
        metadata.created,
      );
      expect(read).toHaveBeenCalledOnce();
      expect(prepared.original.type).toBe(type);
      expect(readVideoMetadata(bytes)).toEqual(metadata);
      expect(readVideoMetadata(await prepared.original.arrayBuffer())).toEqual(metadata);
      expect(prepared.photo.exif.location).toBeUndefined();
      expect(prepared.photo.exif.dateTimeOriginal).toBe(metadata.created);
      expect(prepared.photo.durationSeconds).toBe(2.5);
    }
  });
});
