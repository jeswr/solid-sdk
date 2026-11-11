// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { listLibrary, searchPhotos } from "../src/apps/photos/lib/data/library";
import { photoDataStorage } from "../src/apps/photos/lib/data/storage";
import { planTakeout } from "../src/apps/photos/lib/data/takeout";
import { importTakeoutPlan, takeoutFailure } from "../src/apps/photos/lib/data/takeout-import";
import { uploadFiles } from "../src/apps/photos/lib/data/upload";
import {
  buildPhoto,
  formatDuration,
  type ImageEncoder,
  type Photo,
  PhotographDoc,
  parseDuration,
  parsePhoto,
  parsePhotos,
  preparePhoto,
  readVideoMetadata,
  stripVideoLocation,
  VideoLocationError,
} from "../src/apps/photos/lib/model";
import {
  PHOTOGRAPH_CLASS,
  RDF_TYPE,
  SCHEMA,
  VIDEO_CLASS,
  XSD,
} from "../src/apps/photos/lib/model/vocab";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://alice.demo.pod/";
const NOW = "2026-11-11T12:00:00.000Z";
const ITEM = `${ROOT}photos/items/clip.ttl`;
const text = (value: string) => new TextEncoder().encode(value);
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function box(
  type: string,
  payload = new Uint8Array(),
  size: "normal" | "large" | "end" = "normal",
) {
  const header = new Uint8Array(size === "large" ? 16 : 8);
  const view = new DataView(header.buffer);
  view.setUint32(0, size === "large" ? 1 : size === "end" ? 0 : header.length + payload.length);
  header.set(
    [...type].map((char) => char.charCodeAt(0)),
    4,
  );
  if (size === "large") view.setBigUint64(8, BigInt(header.length + payload.length));
  return concat(header, payload);
}
function mvhd(
  version = 0,
  created = BigInt("3877243200"),
  duration = BigInt("62500"),
  timescale = 1000,
) {
  const payload = new Uint8Array(version === 1 ? 112 : 100);
  const view = new DataView(payload.buffer);
  payload[0] = version;
  if (version === 1) {
    view.setBigUint64(4, created);
    view.setUint32(20, timescale);
    view.setBigUint64(24, duration);
  } else {
    view.setUint32(4, Number(created));
    view.setUint32(12, timescale);
    view.setUint32(16, Number(duration));
  }
  return box("mvhd", payload);
}
function xyz(value = "+51.5074-000.1278/", size: "normal" | "large" | "end" = "normal") {
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint16(0, value.length);
  return box("©xyz", concat(header, text(value)), size);
}
const movie = () =>
  concat(
    box("ftyp", text("isom0000")),
    box("moov", concat(mvhd(), box("udta", xyz()))),
    box("mdat", text("pixels")),
  );
function encoder(durationSeconds: number | undefined = 8): ImageEncoder {
  return {
    dimensions: vi.fn(async () => ({ width: 1920, height: 1080, durationSeconds })),
    thumbnail: vi.fn(async () => new Blob(["thumbnail"], { type: "image/webp" })),
    stripLocation: vi.fn(
      async (original) =>
        new Blob([stripVideoLocation(await original.arrayBuffer())], { type: original.type }),
    ),
  };
}

describe("video durations and RDF", () => {
  it("strictly parses fixed ISO durations and preserves finite nonnegative seconds", () => {
    for (const [value, seconds] of [
      ["PT0S", 0],
      ["PT1M2.5S", 62.5],
      ["P2D", 172800],
      ["P1DT2H3M4.25S", 93784.25],
      ["PT60S", 60],
    ] as const)
      expect(parseDuration(value)).toBe(seconds);
    for (const seconds of [
      0,
      -0,
      62.5,
      3600,
      Number.MAX_SAFE_INTEGER,
      1e-7,
      1.23e-8,
      Number.MIN_VALUE,
    ])
      expect(parseDuration(formatDuration(seconds))).toBe(seconds || 0);
    for (const value of [
      "P",
      "PT",
      "P1DT",
      "P1Y",
      "P1M",
      "P1W",
      "PT-1S",
      "-PT1S",
      "PT1.2M",
      "PT.5S",
      "PT1e3S",
      " PT1S",
      "PT1S\n",
      "PT1H2H",
      "P0.5D",
      `PT${"9".repeat(400)}S`,
      "P99999999999999999D",
    ])
      expect(parseDuration(value)).toBeUndefined();
    for (const seconds of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => formatDuration(seconds)).toThrow(TypeError);
  });
  it("writes VideoObject with typed duration and round-trips its shared photo metadata", () => {
    const photo: Photo = {
      kind: "video",
      durationSeconds: 62.5,
      name: "Lake",
      contentUrl: `${ROOT}photos/originals/clip.mp4`,
      thumbnailUrl: `${ROOT}photos/thumbs/clip.webp`,
      keywords: ["water"],
      created: NOW,
      modified: NOW,
      exif: {
        dateTimeOriginal: NOW,
        pixelWidth: 1920,
        pixelHeight: 1080,
        location: { lat: 51.5, long: -0.12 },
      },
    };
    const dataset = buildPhoto(ITEM, photo);
    expect(parsePhoto(ITEM, dataset)).toEqual(photo);
    expect(parsePhotos(ITEM, dataset)).toEqual([{ subject: `${ITEM}#it`, photo }]);
    const doc = new PhotographDoc(`${ITEM}#it`, dataset, DataFactory);
    expect([...doc.types]).toEqual([VIDEO_CLASS]);
    expect(
      dataset.match(null, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(PHOTOGRAPH_CLASS))
        .size,
    ).toBe(0);
    const literal = [...dataset.match(null, DataFactory.namedNode(`${SCHEMA}duration`))][0]?.object;
    expect(literal).toEqual(
      DataFactory.literal("PT62.5S", DataFactory.namedNode(`${XSD}duration`)),
    );
    doc.durationSeconds = undefined;
    expect(parsePhoto(ITEM, dataset)?.durationSeconds).toBeUndefined();
    for (const term of [
      DataFactory.namedNode(`${ROOT}not-a-literal`),
      DataFactory.literal("PT1S"),
      DataFactory.literal("bad", DataFactory.namedNode(`${XSD}duration`)),
    ]) {
      dataset.add(
        DataFactory.quad(
          DataFactory.namedNode(`${ITEM}#it`),
          DataFactory.namedNode(`${SCHEMA}duration`),
          term,
        ),
      );
      expect(parsePhoto(ITEM, dataset)?.durationSeconds).toBeUndefined();
      dataset.deleteMatches(undefined, DataFactory.namedNode(`${SCHEMA}duration`));
    }
    expect(() => {
      doc.durationSeconds = -1;
    }).toThrow(TypeError);
  });
});

describe("bounded ISO BMFF metadata", () => {
  it("reads v0 and v1 creation times and fractional durations, including byte subviews", () => {
    for (const version of [0, 1]) {
      const bytes = box("moov", mvhd(version));
      const padded = concat(new Uint8Array(3), bytes, new Uint8Array(2));
      expect(readVideoMetadata(padded.subarray(3, -2))).toEqual({
        created: "2026-11-11T12:00:00.000Z",
        durationSeconds: 62.5,
      });
      expect(readVideoMetadata(bytes.buffer)).toEqual(readVideoMetadata(bytes));
    }
    expect(readVideoMetadata(mvhd())).toEqual({}); // Not a movie header outside moov.
    expect(readVideoMetadata(box("moov", mvhd(0, BigInt("0"), BigInt("0"))))).toEqual({
      durationSeconds: 0,
    });
    expect(
      readVideoMetadata(
        box("moov", mvhd(1, BigInt("255485145600"), BigInt("0xffffffffffffffff"), 0)),
      ),
    ).toEqual({});
    expect(readVideoMetadata(box("moov", mvhd(0, BigInt("0"), BigInt("0xffffffff"))))).toEqual({});
    expect(
      readVideoMetadata(
        box("moov", mvhd(1, BigInt("0"), BigInt(Number.MAX_SAFE_INTEGER) + BigInt("1"))),
      ),
    ).toEqual({});
    expect(readVideoMetadata(box("moov", mvhd(2)))).toEqual({});
    for (const version of [0, 1])
      expect(readVideoMetadata(box("moov", box("mvhd", Uint8Array.of(version))))).toEqual({});
    expect(readVideoMetadata(box("moov", box("mvhd")))).toEqual({});
  });
  it("reads bounded ISO 6709 coordinates and rejects malformed or out-of-range positions", () => {
    expect(readVideoMetadata(movie()).location).toEqual({ lat: 51.5074, long: -0.1278 });
    for (const value of ["+90-180/", "-90+180+120.5/", "+00.0-000.0/"])
      expect(readVideoMetadata(box("udta", xyz(value))).location).toBeDefined();
    expect(readVideoMetadata(box("udta", xyz("+00.0-000.0/"))).location).toEqual({
      lat: 0,
      long: 0,
    });
    for (const value of [
      "+91.0+000.0/",
      "+00.0-181.0/",
      "51.5,-0.1",
      "+51.5-000.1",
      "+51.5-000.1/garbage",
      "+99.9+999.0/",
    ])
      expect(readVideoMetadata(box("udta", xyz(value)))).toEqual({});
    expect(readVideoMetadata(box("©xyz", new Uint8Array(3)))).toEqual({});
    expect(readVideoMetadata(box("©xyz", Uint8Array.of(0, 10, 0, 0)))).toEqual({});
  });
  it("preserves box extents and clears unreferenced media when scrubbing legacy location", () => {
    for (const size of ["normal", "large"] as const) {
      const source = concat(
        box("ftyp", text("isom")),
        box("moov", concat(mvhd(), box("udta", concat(xyz(), xyz("+20.0+030.0/", size))))),
        box("mdat", text("original media bytes")),
      );
      const before = source.slice();
      const stripped = stripVideoLocation(source);
      expect(stripped).toBe(source);
      expect(stripped.length).toBe(source.length);
      expect(readVideoMetadata(stripped)).toEqual({ created: NOW, durationSeconds: 62.5 });
      expect(new TextDecoder().decode(stripped)).not.toContain("+51.5074");
      expect(stripped.slice(-28, -20)).toEqual(before.slice(-28, -20));
      expect(stripped.slice(-20)).toEqual(new Uint8Array(20));
      const restored = stripped.slice();
      // The removed udta header keeps its size, and its entire payload is zero.
      const udta = Buffer.from(before).indexOf(Buffer.from("udta"));
      expect(stripped.slice(udta - 4, udta)).toEqual(before.slice(udta - 4, udta));
      const end = udta - 4 + new DataView(before.buffer).getUint32(udta - 4);
      expect(stripped.slice(udta + 4, end).every((byte) => byte === 0)).toBe(true);
      expect(stripVideoLocation(restored.buffer)).toEqual(restored);
    }
    const meta = box("meta", concat(new Uint8Array(4), box("ilst", xyz())));
    expect(readVideoMetadata(stripVideoLocation(meta))).toEqual({});
    expect(stripVideoLocation(box("free", text("unchanged")))).toEqual(
      box("free", new Uint8Array(text("unchanged").length)),
    );
  });
  it("rejects malformed sizes, truncated children and overlapping extents without partial metadata", () => {
    const oversized = box("free");
    new DataView(oversized.buffer).setUint32(0, 100);
    const unsafe = box("free", new Uint8Array(), "large");
    new DataView(unsafe.buffer).setBigUint64(8, BigInt("2") ** BigInt("63"));
    const undersized = box("free");
    new DataView(undersized.buffer).setUint32(0, 4);
    const largeSmall = box("free", new Uint8Array(), "large");
    new DataView(largeSmall.buffer).setBigUint64(8, BigInt("8"));
    const malformed = [
      text("garbage"),
      oversized,
      unsafe,
      undersized,
      largeSmall,
      box("free", new Uint8Array(), "large").slice(0, 12),
      box("moov", text("bad")),
      box("meta", new Uint8Array(3)),
      // A nested size-0 child is ambiguous with a QuickTime terminator.
      box("udta", xyz("+20.0+030.0/", "end")),
      concat(movie(), Uint8Array.of(1)),
    ];
    for (const bytes of malformed) {
      expect(readVideoMetadata(bytes)).toEqual({});
      expect(() => stripVideoLocation(bytes)).toThrow(VideoLocationError);
      expect(() => stripVideoLocation(bytes)).toThrow("Turn off Remove location for this video");
    }
    expect(readVideoMetadata(new Uint8Array())).toEqual({});
  });
  it("removes Apple's location key in metadata and unreferenced media", () => {
    const key = text("com.apple.quicktime.location.ISO6709");
    for (const bytes of [key, concat(key, movie())]) {
      const before = bytes.slice();
      expect(() => stripVideoLocation(bytes)).toThrow(VideoLocationError);
      expect(bytes).toEqual(before);
    }
    expect(new TextDecoder().decode(stripVideoLocation(box("keys", key)))).not.toContain(
      "com.apple",
    );
    const media = concat(movie(), box("mdat", key));
    expect(stripVideoLocation(media).slice(-key.length)).toEqual(new Uint8Array(key.length));
    const toEnd = box("mdat", key, "end");
    expect(stripVideoLocation(toEnd)).toEqual(box("mdat", new Uint8Array(key.length), "end"));
  });
});

describe("video upload and Takeout data paths", () => {
  it("prepares MP4/MOV metadata, sidecar gap filling, WebM duration and privacy", async () => {
    for (const [type, ext] of [
      ["video/mp4", "mp4"],
      ["video/quicktime", "mov"],
      ["video/webm", "webm"],
    ] as const) {
      const original = new Blob([type === "video/webm" ? text("webm") : movie()], { type });
      const image = encoder();
      const input = {
        original,
        id: "clip",
        name: "Lake",
        stripLocation: false,
        metadata: {
          dateTimeOriginal: "2020-01-01T00:00:00Z",
          location: { lat: 1, long: 2 },
          description: "  Lake breeze  ",
        },
      };
      const prepared = await preparePhoto(ROOT, input, image, NOW);
      expect(prepared.photo).toMatchObject({
        kind: "video",
        durationSeconds: type === "video/webm" ? 8 : 62.5,
        contentUrl: `${ROOT}photos/originals/clip.${ext}`,
        thumbnailUrl: `${ROOT}photos/thumbs/clip.webp`,
        description: "Lake breeze",
        exif: {
          pixelWidth: 1920,
          pixelHeight: 1080,
          dateTimeOriginal: type === "video/webm" ? "2020-01-01T00:00:00.000Z" : NOW,
          location: type === "video/webm" ? { lat: 1, long: 2 } : { lat: 51.5074, long: -0.1278 },
        },
      });
      expect(prepared.plan).toEqual({
        width: 320,
        height: 180,
        orientation: 1,
        contentType: "image/webp",
      });
      expect(parsePhoto(ITEM, buildPhoto(ITEM, prepared.photo))).toEqual(prepared.photo);
      if (type !== "video/webm") {
        const stripped = await preparePhoto(ROOT, { ...input, stripLocation: true }, image, NOW);
        expect(stripped.photo.exif.location).toBeUndefined();
        expect(readVideoMetadata(await stripped.original.arrayBuffer()).location).toBeUndefined();
      }
    }
    const input = {
      id: "empty",
      name: "Untitled",
      original: new Blob([box("moov")], { type: "video/mp4" }),
      stripLocation: false,
    };
    const unknown = encoder();
    unknown.dimensions = async () => ({ width: 1920, height: 1080 });
    expect((await preparePhoto(ROOT, input, unknown, NOW)).photo.durationSeconds).toBeUndefined();
    await expect(preparePhoto(ROOT, input, encoder(-1), NOW)).rejects.toThrow("duration");
  });
  it("retains WebM duration across a failed upload retry and uses create preconditions", async () => {
    const pod = createDemoPod({ root: ROOT });
    let fail = true;
    const headers: Headers[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT") {
        headers.push(new Headers(init.headers));
        if (String(input) === ITEM && fail) return new Response(null, { status: 500 });
      }
      return pod.fetch(input, init);
    };
    const io = photoDataStorage(fetch, ROOT);
    const image = encoder(62.5);
    const input = { name: "clip.webm", original: new Blob(["webm"], { type: "video/webm" }) };
    const options = { encoder: image, id: () => "clip", now: NOW, stripLocation: false };
    expect((await uploadFiles(io, [input], options))[0]?.ok).toBe(false);
    fail = false;
    expect((await uploadFiles(io, [input], options))[0]?.ok).toBe(true);
    expect(image.dimensions).toHaveBeenCalledOnce();
    const library = await listLibrary(io);
    expect(library.items[0]).toMatchObject({ kind: "video", durationSeconds: 62.5 });
    expect(searchPhotos(library.items, [], "video")).toHaveLength(1);
    expect(headers.every((value) => value.get("if-none-match") === "*")).toBe(true);
  });
  it("imports deduplicated MP4/MOV/WebM items with sidecars and albums through the demo pod", async () => {
    const pod = createDemoPod({ root: ROOT });
    const io = photoDataStorage(pod.fetch, ROOT);
    const sidecar = new Blob([
      JSON.stringify({
        photoTakenTime: { timestamp: "1577836800" },
        description: "From Takeout",
        geoData: { latitude: 10, longitude: 20 },
      }),
    ]);
    const plan = await planTakeout([
      ...["mp4", "mov", "webm"].flatMap((ext) => [
        {
          path: `Trip/clip.${ext}`,
          file: new Blob([ext === "webm" ? text("webm") : box("moov")], {
            type: "application/octet-stream",
          }),
        },
        { path: `Trip/clip.${ext}.json`, file: sidecar },
      ]),
      { path: "Year/clip.webm", file: new Blob(["webm"]) },
      { path: "Trip/metadata.json", file: new Blob([JSON.stringify({ title: "Trip" })]) },
      { path: "Year/old.avi", file: new Blob(["unsupported"]) },
    ]);
    expect(plan).toMatchObject({ videos: 3, duplicates: 1, withDetails: 3, unsupported: 1 });
    expect(plan.items.map((item) => item.file.type)).toEqual([
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ]);
    const album = vi.fn(async () => true);
    let id = 0;
    const result = await importTakeoutPlan(plan, {
      upload: async (items) => {
        const outcomes = await uploadFiles(
          io,
          items.map((item) => ({ name: item.name, original: item.file, metadata: item.metadata })),
          { encoder: encoder(2.5), id: () => `takeout-${++id}`, now: NOW, stripLocation: false },
        );
        return outcomes.map((outcome) =>
          outcome.ok ? `${outcome.url}#it` : { kind: "pod" as const },
        );
      },
      findAlbum: () => undefined,
      createAlbum: album,
      addToAlbum: album,
    });
    expect(result).toMatchObject({ saved: 3, albums: 1, unreadable: [] });
    const library = await listLibrary(io);
    expect(library.items).toHaveLength(3);
    for (const photo of library.items)
      expect(photo).toMatchObject({
        kind: "video",
        durationSeconds: 2.5,
        description: "From Takeout",
        exif: { dateTimeOriginal: "2020-01-01T00:00:00.000Z", location: { lat: 10, long: 20 } },
      });
    const retry = await importTakeoutPlan(plan, {
      upload: async (items) => items.map(() => ({ kind: "pod" as const })),
      findAlbum: () => undefined,
      createAlbum: album,
      addToAlbum: album,
    });
    expect(retry.retry?.videos).toBe(3);
  });
  it("reports video-specific import failures and actionable location refusal", () => {
    expect(takeoutFailure({ status: 415 }, "video/mp4", false)).toEqual({
      kind: "photo",
      reason: "Your pod refused this video (error 415).",
    });
    expect(takeoutFailure(new Error("decode"), "video/webm", false)).toMatchObject({
      reason: expect.stringContaining("this video"),
    });
    const error = new VideoLocationError("Turn off Remove location for this video.");
    expect(takeoutFailure(error, "video/mp4", true)).toEqual({
      kind: "photo",
      reason: error.message,
    });
  });
});
