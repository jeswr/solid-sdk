// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { smartAlbum } from "../src/apps/photos/lib/albums";
import { ExifError, type ExifErrorCode, parseExif } from "../src/apps/photos/lib/exif";

type Field = { tag: number; type: 2 | 3 | 4 | 5; value: string | number[] };
function get<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error("Missing synthetic fixture entry");
  return value;
}

type IfdName = "root" | "exif" | "gps" | "thumb";
const ascii = (tag: number, value: string): Field => ({ tag, type: 2, value: `${value}\0` });
const short = (tag: number, ...value: number[]): Field => ({ tag, type: 3, value });
const long = (tag: number, ...value: number[]): Field => ({ tag, type: 4, value });
const rational = (tag: number, value: number[]): Field => ({ tag, type: 5, value });
const join = (...arrays: Uint8Array[]) => Uint8Array.from(arrays.flatMap((a) => [...a]));
const segment = (marker: number, data: Uint8Array) =>
  join(Uint8Array.of(0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255), data);
const app1 = (tiff: Uint8Array) =>
  segment(0xe1, join(Uint8Array.of(69, 120, 105, 102, 0, 0), tiff));
const jpeg = (...segments: Uint8Array[]) =>
  join(Uint8Array.of(0xff, 0xd8), ...segments, Uint8Array.of(0xff, 0xd9));

/** Tiny synthetic TIFF writer: directory tables first, aligned payloads second. */
function fixture(options: { little?: boolean } & Partial<Record<IfdName, Field[]>> = {}) {
  const little = options.little ?? true;
  const dirs = new Map<IfdName, Field[]>([["root", [...(options.root ?? [])]]]);
  for (const [name, tag] of [
    ["exif", 0x8769],
    ["gps", 0x8825],
  ] as const) {
    if (options[name]) {
      dirs.set(name, options[name]);
      get(dirs, "root").push(long(tag, 0));
    }
  }
  if (options.thumb) dirs.set("thumb", options.thumb);
  const offsets = new Map<IfdName, number>();
  let end = 8;
  for (const [name, fields] of dirs) {
    offsets.set(name, end);
    end += 2 + fields.length * 12 + 4;
  }
  const storage = new Uint8Array(8192);
  let view = new DataView(storage.buffer);
  const u16 = (at: number, value: number) => view.setUint16(at, value, little);
  const u32 = (at: number, value: number) => view.setUint32(at, value, little);
  u16(0, little ? 0x4949 : 0x4d4d);
  u16(2, 42);
  u32(4, get(offsets, "root"));
  const entries = new Map<string, number>();
  for (const [name, fields] of dirs) {
    const base = get(offsets, name);
    u16(base, fields.length);
    fields.forEach((field, i) => {
      const at = base + 2 + i * 12;
      entries.set(`${name}:${field.tag}`, at);
      let values = field.value;
      if (name === "root" && field.tag === 0x8769) values = [get(offsets, "exif")];
      if (name === "root" && field.tag === 0x8825) values = [get(offsets, "gps")];
      const size = { 2: 1, 3: 2, 4: 4, 5: 4 }[field.type];
      const length = values.length * size;
      u16(at, field.tag);
      u16(at + 2, field.type);
      u32(at + 4, field.type === 5 ? values.length / 2 : values.length);
      const target = length <= 4 ? at + 8 : end;
      if (length > 4) {
        u32(at + 8, target);
        end += length + (length % 2);
      }
      if (typeof values === "string") {
        for (let j = 0; j < values.length; j++) storage[target + j] = values.charCodeAt(j);
      } else {
        values.forEach((value, j) => {
          if (field.type === 3) u16(target + j * size, value);
          else u32(target + j * size, value);
        });
      }
    });
    u32(base + 2 + fields.length * 12, name === "root" ? (offsets.get("thumb") ?? 0) : 0);
  }
  const bytes = storage.slice(0, end);
  view = new DataView(bytes.buffer);
  const entry = (name: IfdName, tag: number) => get(entries, `${name}:${tag}`);
  const data = (name: IfdName, tag: number) => view.getUint32(entry(name, tag) + 8, little);
  const next = (name: IfdName) => get(offsets, name) + 2 + get(dirs, name).length * 12;
  return { bytes, offsets, entry, data, next, u16, u32, jpeg: () => jpeg(app1(bytes)) };
}

const root = [
  ascii(0x010f, "Example Camera Co"),
  ascii(0x0110, "Fictional Camera"),
  short(0x0112, 6),
  short(0x0100, 640),
  long(0x0101, 480),
];
const exif = [
  ascii(0x9003, "2024:02:29 12:34:56"),
  ascii(0x9011, "+05:45"),
  long(0xa002, 4000),
  short(0xa003, 3000),
];
const gps = [
  ascii(1, "N"),
  rational(2, [51, 1, 30, 1, 15, 2]),
  ascii(3, "W"),
  rational(4, [0, 1, 7, 1, 30, 1]),
];

function rejects(bytes: Uint8Array, code: ExifErrorCode) {
  expect(() => parseExif(bytes)).toThrow(ExifError);
  expect(() => parseExif(bytes)).toThrow(expect.objectContaining({ name: "ExifError", code }));
}

describe("JPEG APP1 Exif", () => {
  it("rejects detached and shared buffers with a typed error", () => {
    const bytes = fixture().jpeg();
    const buffer = bytes.buffer;
    structuredClone(buffer, { transfer: [buffer] });
    for (const input of [bytes, buffer, new Uint8Array(new SharedArrayBuffer(8))]) {
      expect(() => parseExif(input)).toThrow(expect.objectContaining({ code: "invalid-input" }));
    }
  });

  it.each([true, false])("rejects every truncated prefix of a complete fixture (%s)", (little) => {
    const image = fixture({ little, root, exif, gps }).jpeg();
    for (let i = 0; i < image.length; i++) {
      expect(() => parseExif(image.subarray(0, i)), `prefix ${i}`).toThrow(ExifError);
    }
  });

  it.each([true, false])("reads all requested fields (little endian: %s)", (little) => {
    const image = fixture({ little, root, exif, gps }).jpeg();
    const before = image.slice();
    const result = parseExif(image);
    expect(result).toEqual({
      make: "Example Camera Co",
      model: "Fictional Camera",
      orientation: 6,
      dateTimeOriginal: "2024:02:29 12:34:56",
      offsetTimeOriginal: "+05:45",
      width: 4000,
      height: 3000,
      gps: { latitude: 51 + 30 / 60 + 7.5 / 3600, longitude: -(7 / 60 + 30 / 3600) },
    });
    expect(parseExif(image.buffer)).toEqual(result);
    const padded = join(Uint8Array.of(9, 9, 9), image, Uint8Array.of(9));
    expect(parseExif(padded.subarray(3, padded.length - 1))).toEqual(result);
    expect(image).toEqual(before);
  });

  it("distinguishes no Exif from an empty Exif directory and returns fresh results", () => {
    expect(parseExif(jpeg())).toBeNull();
    const image = fixture().jpeg();
    expect(parseExif(image)).toEqual({});
    expect(parseExif(image)).not.toBe(parseExif(image));
    expect(parseExif(fixture({ exif: [], gps: [] }).jpeg())).toEqual({});
  });

  it("skips other segments, marker padding, TEM and non-Exif APP1 data", () => {
    const segments = [
      segment(0xe0, Uint8Array.of(1)),
      segment(0xfe, new Uint8Array()),
      segment(0xe1, new Uint8Array()),
      segment(0xe1, Uint8Array.of(1, 2, 3, 4)),
      segment(0xe1, Uint8Array.of(69, 1, 2, 3)),
      segment(0xe1, Uint8Array.of(69, 120, 1, 2)),
      segment(0xe1, Uint8Array.of(69, 120, 105, 1)),
      Uint8Array.of(0xff, 0x01, 0xff),
    ];
    expect(parseExif(jpeg(...segments, app1(fixture().bytes)))).toEqual({});
  });

  it("stops at SOS without scanning entropy data as metadata", () => {
    const scan = segment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0));
    expect(parseExif(jpeg(scan, app1(fixture().bytes)))).toBeNull();
    expect(parseExif(jpeg(app1(fixture().bytes), scan, Uint8Array.of(0, 255, 0)))).toEqual({});
  });

  it.each([
    null,
    undefined,
    "jpeg",
    new DataView(new ArrayBuffer(4)),
    [255, 216],
  ])("rejects non-byte input %s", (input) => {
    expect(() => parseExif(input as unknown as Uint8Array)).toThrow(
      expect.objectContaining({ code: "invalid-input" }),
    );
  });

  it.each(
    [
      [],
      [255],
      [0, 216],
      [255, 0],
      [255, 216, 0],
      [255, 216, 255, 0],
      [255, 216, 255, 0xd0],
      [255, 216, 255, 0xd8],
      [255, 216, 255, 0xbf],
      [255, 216, 255, 0xe1, 0, 0],
      [255, 216, 255, 0xe1, 0, 1],
    ].map((bytes) => [bytes]),
  )("rejects malformed JPEG %s", (bytes) => rejects(Uint8Array.from(bytes), "invalid-jpeg"));

  it.each(
    [
      [255, 216],
      [255, 216, 255],
      [255, 216, 255, 255],
      [255, 216, 255, 225],
      [255, 216, 255, 225, 0],
      [255, 216, 255, 225, 0, 9],
      [255, 216, 255, 218, 0, 9],
    ].map((bytes) => [bytes]),
  )("rejects truncated JPEG %s", (bytes) => rejects(Uint8Array.from(bytes), "out-of-bounds"));

  it.each(
    [
      [69, 120, 105, 102],
      [69, 120, 105, 102, 0],
      [69, 120, 105, 102, 1, 0],
      [69, 120, 105, 102, 0, 1],
    ].map((bytes) => [bytes]),
  )("rejects malformed Exif identifiers %s", (bytes) =>
    rejects(jpeg(segment(0xe1, Uint8Array.from(bytes))), "invalid-tiff"));

  it("rejects duplicate Exif segments, including an empty first segment", () => {
    const block = app1(fixture().bytes);
    rejects(jpeg(block, block), "duplicate-exif");
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])("bounds-checks TIFF header length %s", (length) =>
    rejects(jpeg(app1(fixture().bytes.subarray(0, length))), "out-of-bounds"));

  it("bounds-checks APP1 independently of later JPEG bytes", () => {
    const f = fixture({ root: [ascii(0x010f, "Example Camera")] });
    const truncated = f.bytes.subarray(0, f.data("root", 0x010f) + 2);
    rejects(jpeg(app1(truncated), segment(0xe0, new Uint8Array(100))), "out-of-bounds");
  });
});

describe("TIFF structure", () => {
  it("walks a long IFD chain without recursion and rejects a cycle at its end", () => {
    const bytes = new Uint8Array(8 + 5000 * 6);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0x4949, true);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    for (let at = 8; at < bytes.length - 6; at += 6) view.setUint32(at + 2, at + 6, true);
    expect(parseExif(jpeg(app1(bytes)))).toEqual({});
    view.setUint32(bytes.length - 4, 8, true);
    rejects(jpeg(app1(bytes)), "invalid-ifd");
  });

  it("accepts shared external payloads without interpreting them twice as directories", () => {
    const f = fixture({ root: [ascii(0x010f, "Example"), ascii(0x0110, "Example")] });
    f.u32(f.entry("root", 0x0110) + 8, f.data("root", 0x010f));
    expect(parseExif(f.jpeg())).toEqual({ make: "Example", model: "Example" });
  });

  it.each([0, 0x494d, 0x4d49])("rejects byte-order signature %s", (order) => {
    const f = fixture();
    f.u16(0, order);
    rejects(f.jpeg(), "invalid-tiff");
  });
  it.each([0, 43])("rejects TIFF version %s", (version) => {
    const f = fixture();
    f.u16(2, version);
    rejects(f.jpeg(), "invalid-tiff");
  });
  it.each([0, 2, 7, 9])("rejects invalid IFD0 offset %s", (offset) => {
    const f = fixture();
    f.u32(4, offset);
    rejects(f.jpeg(), "invalid-ifd");
  });
  it.each([14, 0xfffffffe])("rejects out-of-bounds IFD0 offset %s", (offset) => {
    const f = fixture();
    f.u32(4, offset);
    rejects(f.jpeg(), "out-of-bounds");
  });
  it("bounds-checks the IFD entry count and trailing next pointer", () => {
    const f = fixture();
    f.u16(8, 0xffff);
    rejects(f.jpeg(), "out-of-bounds");
    rejects(jpeg(app1(fixture().bytes.subarray(0, 13))), "out-of-bounds");
  });
  it.each([0, 13, 65535])("rejects unsupported TIFF type %s even on unrequested tags", (type) => {
    const f = fixture({ root: [short(0x1234, 1)] });
    f.u16(f.entry("root", 0x1234) + 2, type);
    rejects(f.jpeg(), "unsupported-type");
  });
  it("rejects zero counts, oversized payloads, header pointers and unaligned pointers", () => {
    const f = fixture({ root: [ascii(0x010f, "Example")] });
    const entry = f.entry("root", 0x010f);
    f.u32(entry + 4, 0);
    rejects(f.jpeg(), "invalid-tag");
    f.u32(entry + 4, 0xffffffff);
    rejects(f.jpeg(), "out-of-bounds");
    f.u32(entry + 4, 8);
    for (const offset of [0, 2, 9]) {
      f.u32(entry + 8, offset);
      rejects(f.jpeg(), "invalid-ifd");
    }
  });
  it("rejects duplicate tags", () => {
    const f = fixture({ root: [short(0x1234, 1), short(0x1235, 2)] });
    f.u16(f.entry("root", 0x1235), 0x1234);
    rejects(f.jpeg(), "invalid-ifd");
  });
  it("checks but never extracts primary fields from thumbnail chains", () => {
    const f = fixture({ root: [short(0x0112, 2)], thumb: [...root, ...exif] });
    expect(parseExif(f.jpeg())).toEqual({ orientation: 2 });
  });
  it("rejects self loops, cross-directory cycles and reused directory pointers", () => {
    const f = fixture({ exif: [], gps: [], thumb: [] });
    f.u32(f.next("thumb"), get(f.offsets, "thumb"));
    rejects(f.jpeg(), "invalid-ifd");
    f.u32(f.next("thumb"), get(f.offsets, "root"));
    rejects(f.jpeg(), "invalid-ifd");
    f.u32(f.next("thumb"), get(f.offsets, "exif"));
    rejects(f.jpeg(), "invalid-ifd");
    f.u32(f.next("thumb"), 0);
    f.u32(f.entry("root", 0x8825) + 8, get(f.offsets, "exif"));
    rejects(f.jpeg(), "invalid-ifd");
  });
  it("rejects malformed child pointer types, counts and null pointers", () => {
    const f = fixture({ exif: [] });
    const entry = f.entry("root", 0x8769);
    f.u16(entry + 2, 3);
    rejects(f.jpeg(), "invalid-tag");
    f.u16(entry + 2, 4);
    f.u32(entry + 4, 2);
    rejects(f.jpeg(), "out-of-bounds");
    f.u32(entry + 4, 1);
    f.u32(entry + 8, 0);
    rejects(f.jpeg(), "invalid-ifd");
  });
  it("rejects partially overlapping directory tables", () => {
    const f = fixture({ root: [long(0x1234, 0), short(0, 1)] });
    // An empty IFD in the LONG's inline zero bytes overlaps IFD0's table.
    f.u32(f.next("root"), f.entry("root", 0x1234) + 8);
    rejects(f.jpeg(), "invalid-ifd");
  });
  it("rejects payloads overlapping a current or later directory", () => {
    const f = fixture({ root: [ascii(0x010f, "Example")], exif: [] });
    f.u32(f.entry("root", 0x010f) + 8, 8);
    rejects(f.jpeg(), "invalid-ifd");
    f.u32(f.entry("root", 0x010f) + 8, get(f.offsets, "exif") - 2);
    rejects(f.jpeg(), "invalid-ifd");
  });
  it("ignores unrequested values with all TIFF 6 storage types", () => {
    const f = fixture({ root: Array.from({ length: 12 }, (_, i) => long(0x2000 + i, 1, 0, 0, 0)) });
    for (let i = 0; i < 12; i++) {
      const entry = f.entry("root", 0x2000 + i);
      f.u16(entry + 2, i + 1);
      f.u32(entry + 4, 8);
    }
    // Use valid payloads for each type's largest required extent.
    const bytes = join(f.bytes, new Uint8Array(64));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 12; i++)
      view.setUint32(f.entry("root", 0x2000 + i) + 8, f.bytes.length, true);
    expect(parseExif(jpeg(app1(bytes)))).toEqual({});
  });
});

describe("requested metadata validation", () => {
  it.each([
    1, 2, 3, 4, 5, 6, 7, 8,
  ])("preserves orientation %s without rotating dimensions", (value) => {
    expect(
      parseExif(
        fixture({ root: [short(0x0112, value), short(0x0100, 12), long(0x0101, 34)] }).jpeg(),
      ),
    ).toEqual({ orientation: value, width: 12, height: 34 });
  });
  it.each([0, 9, 65535])("rejects orientation %s", (value) =>
    rejects(fixture({ root: [short(0x0112, value)] }).jpeg(), "invalid-tag"));
  it.each([
    long(0x0112, 1),
    short(0x0112, 1, 2),
    ascii(0x0112, "1"),
  ])("rejects wrong orientation type/count %s", (entry) =>
    rejects(fixture({ root: [entry] }).jpeg(), "invalid-tag"));
  it("handles inline, empty and external camera ASCII without trimming", () => {
    expect(parseExif(fixture({ root: [ascii(0x010f, "A B"), ascii(0x0110, "")] }).jpeg())).toEqual({
      make: "A B",
      model: "",
    });
    expect(parseExif(fixture({ root: [ascii(0x010f, " Example ")] }).jpeg())).toEqual({
      make: " Example ",
    });
  });
  it.each([
    ["A B", ""],
    ["", "Model One"],
    ["", ""],
    [" ", "  "],
  ])("accepts parsed blank camera metadata in smart albums (%j, %j)", (make, model) => {
    const root = [ascii(0x010f, make), ascii(0x0110, model)];
    const metadata = parseExif(fixture({ root }).jpeg());
    expect(metadata).toEqual({ make, model });
    const photos = [
      { id: "without-gps", ...metadata },
      { id: "with-gps", ...parseExif(fixture({ root, gps }).jpeg()) },
    ];
    expect(smartAlbum(photos, [])).toEqual(photos);
    expect(smartAlbum(photos, [{ kind: "has-gps", value: true }])).toEqual([photos[1]]);
    expect(smartAlbum(photos, [{ kind: "has-gps", value: false }])).toEqual([photos[0]]);
    expect(smartAlbum(photos, [{ kind: "camera", make: "A B" }])).toEqual(
      make === "A B" ? photos : [],
    );
    expect(smartAlbum(photos, [{ kind: "camera", model: "Model One" }])).toEqual(
      model === "Model One" ? photos : [],
    );
  });
  it.each([
    short(0x010f, 1),
    { tag: 0x010f, type: 2, value: "BAD" } as Field,
    ascii(0x010f, "a\0b"),
    ascii(0x010f, "é"),
    ascii(0x010f, "\n"),
    ascii(0x010f, "\x7f"),
  ])("rejects non-ASCII, nonterminated or wrong-type camera values %s", (entry) =>
    rejects(fixture({ root: [entry] }).jpeg(), "invalid-tag"));
  it.each([
    short(0x0100, 0),
    long(0x0101, 0),
    short(0x0100, 1, 2),
    ascii(0x0101, "12"),
  ])("rejects invalid dimensions %s", (entry) =>
    rejects(fixture({ root: [entry], exif }).jpeg(), "invalid-tag"));
  it("preserves independent dimensions and does not invent missing ones", () => {
    expect(parseExif(fixture({ exif: [long(0xa002, 0xffffffff)] }).jpeg())).toEqual({
      width: 0xffffffff,
    });
  });
  it.each([
    "0001:01:01 00:00:00",
    "1900:02:28 23:59:59",
    "2000:02:29 12:00:00",
    "2023:04:30 01:02:03",
    "9999:12:31 23:59:59",
  ])("preserves valid civil time %s without adding UTC", (value) => {
    expect(parseExif(fixture({ exif: [ascii(0x9003, value)] }).jpeg())).toEqual({
      dateTimeOriginal: value,
    });
  });
  it.each([
    "",
    "2024-02-29T12:34:56",
    "0000:01:01 00:00:00",
    "2024:00:01 00:00:00",
    "2024:13:01 00:00:00",
    "2024:01:00 00:00:00",
    "2023:02:29 00:00:00",
    "1900:02:29 00:00:00",
    "2024:04:31 00:00:00",
    "2024:01:01 24:00:00",
    "2024:01:01 00:60:00",
    "2024:01:01 00:00:60",
    "    :  :     :  :  ",
  ])("rejects invalid civil time %s", (value) =>
    rejects(fixture({ exif: [ascii(0x9003, value)] }).jpeg(), "invalid-tag"));
  it.each(["+00:00", "-00:00", "-03:30", "+23:59"])("preserves explicit offset %s", (value) => {
    expect(parseExif(fixture({ exif: [ascii(0x9011, value)] }).jpeg())).toEqual({
      offsetTimeOriginal: value,
    });
  });
  it.each([
    "Z",
    "+24:00",
    "+05:60",
    "05:00",
    "+5:00",
    "      ",
  ])("rejects invalid offset %s", (value) =>
    rejects(fixture({ exif: [ascii(0x9011, value)] }).jpeg(), "invalid-tag"));
  it.each([
    ["N", "E", 90, 180],
    ["S", "W", -90, -180],
    ["S", "E", -90, 180],
  ])("converts GPS references %s/%s", (lat, lon, latitude, longitude) => {
    expect(
      parseExif(
        fixture({
          gps: [
            ascii(1, lat as string),
            rational(2, [90, 1, 0, 1, 0, 1]),
            ascii(3, lon as string),
            rational(4, [180, 1, 0, 1, 0, 1]),
          ],
        }).jpeg(),
      ),
    ).toEqual({ gps: { latitude, longitude } });
  });
  it("preserves zero without negative zero", () => {
    const result = parseExif(
      fixture({
        gps: [
          ascii(1, "S"),
          rational(2, [0, 1, 0, 1, 0, 1]),
          ascii(3, "W"),
          rational(4, [0, 1, 0, 1, 0, 1]),
        ],
      }).jpeg(),
    );
    expect(result).toEqual({ gps: { latitude: 0, longitude: 0 } });
  });
  it.each([0, 1, 2, 3])("rejects GPS with component %s missing", (missing) =>
    rejects(fixture({ gps: gps.filter((_, i) => i !== missing) }).jpeg(), "invalid-tag"));
  it.each([
    ascii(1, "n"),
    ascii(1, "NN"),
    ascii(3, "Q"),
    short(2, 1, 2, 3),
    rational(2, [1, 1]),
    rational(2, [1, 0, 0, 1, 0, 1]),
    rational(2, [0, 1, 60, 1, 0, 1]),
    rational(2, [0, 1, 0, 1, 60, 1]),
    rational(2, [90, 1, 0, 1, 1, 1]),
    rational(4, [181, 1, 0, 1, 0, 1]),
  ])("rejects malformed GPS %s", (replacement) =>
    rejects(
      fixture({
        gps: gps.map((field) => (field.tag === replacement.tag ? replacement : field)),
      }).jpeg(),
      "invalid-tag",
    ));
});
