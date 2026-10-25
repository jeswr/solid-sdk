// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { buildPhoto, parsePhoto } from "../../src/apps/photos/lib/model/photograph.js";
import {
  type ImageEncoder,
  mapExif,
  preparePhoto,
  readExif,
  thumbnailPlan,
} from "../../src/apps/photos/lib/model/upload.js";
import { GEO, SCHEMA } from "../../src/apps/photos/lib/model/vocab.js";
import { tiffFixture } from "./fixtures.js";

const storage = "https://pod.example/";
const now = "2026-10-25T10:00:00.000Z";
function encoder(): ImageEncoder {
  return {
    dimensions: vi.fn(async () => ({ width: 4000, height: 3000 })),
    thumbnail: vi.fn(async () => new Blob(["webp"], { type: "image/webp" })),
    stripLocation: vi.fn(async () => new Blob([tiffFixture(6, false)], { type: "image/tiff" })),
  };
}
const original = new Blob([tiffFixture(6)], { type: "image/tiff" });
const input = { id: "one", name: "Photo", original, stripLocation: false };

describe("EXIF extraction and upload preparation", () => {
  it.each([
    1, 2, 3, 6, 8,
  ])("maps a real TIFF fixture with orientation %s into RDF", async (orientation) => {
    const exif = await readExif(tiffFixture(orientation));
    expect(exif).toEqual({
      make: "Canon",
      model: "EOS",
      lensModel: "35mm",
      iso: 200,
      focalLengthMm: 35,
      fNumber: 2.8,
      exposureTimeSec: 0.008,
      pixelWidth: 4000,
      pixelHeight: 3000,
      orientation,
      dateTimeOriginal: "2026-06-15T09:41:07.000Z",
      location: { lat: 51.5, long: -0.12 },
    });
    const photo = { name: "Fixture", contentUrl: `${storage}original.tif`, keywords: [], exif };
    expect(parsePhoto(`${storage}item.ttl`, buildPhoto(`${storage}item.ttl`, photo))).toEqual(
      photo,
    );
  });
  it("maps missing, corrupt and revived tags independently", () => {
    expect(
      mapExif({
        Make: false,
        Model: "",
        ISO: "200",
        Orientation: 9,
        DateTimeOriginal: new Date("invalid"),
        latitude: 100,
        longitude: 0,
      }),
    ).toEqual({});
    expect(mapExif({ DateTimeOriginal: new Date(now) })).toEqual({ dateTimeOriginal: now });
    expect(mapExif({})).toEqual({});
  });
  it("handles images without EXIF and rejects unreadable bytes", async () => {
    // A TIFF with no EXIF tags.
    const empty = new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await readExif(empty.buffer)).toEqual({});
    await expect(readExif(new ArrayBuffer(2))).rejects.toThrow();
  });
  it("prepares fixed paths and passes raw orientation to the injected encoder", async () => {
    const image = encoder();
    const prepared = await preparePhoto(storage, input, image, now);
    expect(prepared.itemUrl).toBe(`${storage}photos/items/one.ttl`);
    expect(prepared.photo).toMatchObject({
      contentUrl: `${storage}photos/originals/one.tif`,
      thumbnailUrl: `${storage}photos/thumbs/one.webp`,
      created: now,
      modified: now,
    });
    expect(prepared.original).toBe(original);
    expect(image.stripLocation).not.toHaveBeenCalled();
    expect(image.thumbnail).toHaveBeenCalledWith(original, {
      width: 240,
      height: 320,
      orientation: 6,
      contentType: "image/webp",
    });
  });
  it("strips the binary and emits no geo triples", async () => {
    const image = encoder();
    const prepared = await preparePhoto(storage, { ...input, stripLocation: true }, image, now);
    expect(image.stripLocation).toHaveBeenCalledWith(original);
    expect(image.thumbnail).toHaveBeenCalledWith(prepared.original, prepared.plan);
    expect((await readExif(await prepared.original.arrayBuffer())).location).toBeUndefined();
    const dataset = buildPhoto(prepared.itemUrl, prepared.photo);
    expect([...dataset].filter((quad) => quad.predicate.value.startsWith(GEO))).toHaveLength(0);
    expect(dataset.match(null, DataFactory.namedNode(`${SCHEMA}geo`)).size).toBe(0);
    expect(parsePhoto(prepared.itemUrl, dataset)?.exif.make).toBe("Canon");
  });
  it("validates storage, IDs, media types and encoder output", async () => {
    await expect(preparePhoto(storage.slice(0, -1), input, encoder(), now)).rejects.toThrow();
    await expect(preparePhoto(`${storage}?x/`, input, encoder(), now)).rejects.toThrow();
    await expect(preparePhoto(`${storage}#x/`, input, encoder(), now)).rejects.toThrow();
    await expect(
      preparePhoto(storage, { ...input, id: "../escape" }, encoder(), now),
    ).rejects.toThrow();
    await expect(
      preparePhoto(
        storage,
        { ...input, original: new Blob(["text"], { type: "text/plain" }) },
        encoder(),
        now,
      ),
    ).rejects.toThrow();
    await expect(
      preparePhoto(storage, input, { ...encoder(), thumbnail: async () => new Blob() }, now),
    ).rejects.toThrow();
    await expect(
      preparePhoto(
        storage,
        { ...input, stripLocation: true },
        { ...encoder(), stripLocation: async () => new Blob() },
        now,
      ),
    ).rejects.toThrow();
    await expect(
      preparePhoto(
        storage,
        input,
        {
          ...encoder(),
          dimensions: async () => {
            throw new Error("decode");
          },
        },
        now,
      ),
    ).rejects.toThrow("decode");
  });
});
it("plans every orientation, bounded thumbnails, tiny and invalid dimensions", () => {
  for (const orientation of [1, 2, 3, 4])
    expect(thumbnailPlan(4000, 3000, orientation)).toMatchObject({ width: 320, height: 240 });
  for (const orientation of [5, 6, 7, 8])
    expect(thumbnailPlan(4000, 3000, orientation)).toMatchObject({ width: 240, height: 320 });
  expect(thumbnailPlan(100, 50)).toMatchObject({ width: 100, height: 50, orientation: 1 });
  expect(thumbnailPlan(1, 10000)).toMatchObject({ width: 1, height: 320 });
  for (const [width, height, orientation] of [
    [0, 1, 1],
    [1, -1, 1],
    [NaN, 1, 1],
    [1.5, 1, 1],
    [1, 1, 0],
    [1, 1, 9],
    [1, 1, 1.5],
  ])
    expect(() => thumbnailPlan(width as number, height as number, orientation)).toThrow();
});
