// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  AlbumError,
  type PhotoMetadata,
  type SmartAlbumPredicate,
  smartAlbum,
} from "../src/apps/photos/lib/albums";

const photos = Object.freeze([
  Object.freeze({
    id: "https://example.org/photos/a",
    takenAt: 0,
    make: "Fictional Camera",
    model: "Model One",
    gps: Object.freeze({ latitude: 0, longitude: 0 }),
  }),
  Object.freeze({
    id: "https://example.org/photos/b",
    takenAt: 1000,
    make: "Fictional Camera",
    model: "Model Two",
  }),
  Object.freeze({ id: "https://example.org/photos/c", takenAt: 2000, model: "Model One" }),
  Object.freeze({ id: "https://example.org/photos/d" }),
] as const);

describe("smart albums", () => {
  it("matches empty predicates without sorting, projecting or mutating records", () => {
    const result = smartAlbum(photos, []);
    expect(result).toEqual(photos);
    expect(result).not.toBe(photos);
    expect(result[0]).toBe(photos[0]);
    expect(smartAlbum([], [])).toEqual([]);
  });

  it("uses inclusive instant bounds and excludes missing dates", () => {
    expect(smartAlbum(photos, [{ kind: "date-range", start: 0, end: 1000 }])).toEqual([
      photos[0],
      photos[1],
    ]);
    expect(smartAlbum(photos, [{ kind: "date-range", start: 1000, end: 1000 }])).toEqual([
      photos[1],
    ]);
    expect(smartAlbum(photos, [{ kind: "date-range", start: 1, end: 999 }])).toEqual([]);
    expect(smartAlbum(photos, [{ kind: "date-range", start: -1000, end: -1 }])).toEqual([]);
    expect(
      smartAlbum(
        [{ id: "https://example.org/photos/ancient", takenAt: -8.64e15 }],
        [{ kind: "date-range", start: -8.64e15, end: 8.64e15 }],
      ),
    ).toHaveLength(1);
  });

  it("matches exact make/model independently or together, without normalising case", () => {
    expect(smartAlbum(photos, [{ kind: "camera", make: "Fictional Camera" }])).toEqual([
      photos[0],
      photos[1],
    ]);
    expect(smartAlbum(photos, [{ kind: "camera", model: "Model One" }])).toEqual([
      photos[0],
      photos[2],
    ]);
    expect(
      smartAlbum(photos, [{ kind: "camera", make: "Fictional Camera", model: "Model One" }]),
    ).toEqual([photos[0]]);
    expect(smartAlbum(photos, [{ kind: "camera", make: "fictional camera" }])).toEqual([]);
    expect(smartAlbum(photos, [{ kind: "camera", model: "Model One " }])).toEqual([]);
  });

  it("checks GPS presence (including zero coordinates) and ANDs all predicates", () => {
    expect(smartAlbum(photos, [{ kind: "has-gps", value: true }])).toEqual([photos[0]]);
    expect(smartAlbum(photos, [{ kind: "has-gps", value: false }])).toEqual(photos.slice(1));
    expect(
      smartAlbum(photos, [
        { kind: "date-range", start: 0, end: 1000 },
        { kind: "camera", make: "Fictional Camera" },
        { kind: "has-gps", value: false },
      ]),
    ).toEqual([photos[1]]);
    expect(
      smartAlbum(photos, [
        { kind: "has-gps", value: true },
        { kind: "has-gps", value: false },
      ]),
    ).toEqual([]);
    expect(
      smartAlbum(
        [
          { id: "https://example.org/photos/north", gps: { latitude: 90, longitude: 180 } },
          { id: "https://example.org/photos/south", gps: { latitude: -90, longitude: -180 } },
        ],
        [{ kind: "has-gps", value: true }],
      ),
    ).toHaveLength(2);
  });

  it.for([
    null,
    {},
    [null],
    [{ kind: "unknown" }],
    [{ kind: "camera" }],
    [{ kind: "camera", make: "" }],
    [{ kind: "camera", model: "  " }],
    [{ kind: "camera", make: 3 }],
    [{ kind: "has-gps", value: "true" }],
    [{ kind: "date-range", start: 1, end: 0 }],
    ...[NaN, Infinity, -Infinity, 8.64e15 + 1, 0.5, "2026-01-01", null].flatMap((value) => [
      [{ kind: "date-range", start: value, end: 1000 }],
      [{ kind: "date-range", start: 0, end: value }],
    ]),
  ])("rejects malformed predicates even over empty input: %j", (predicates) => {
    expect(() => smartAlbum([], predicates as readonly SmartAlbumPredicate[])).toThrow(
      new AlbumError("invalid-predicate"),
    );
  });

  it.for([
    null,
    {},
    [null],
    [{ id: "" }],
    [{ id: 123 }],
    ...[NaN, Infinity, -8.64e15 - 1, 0.1, "2026:10:26 12:00:00", null].map((takenAt) => [
      { id: "https://example.org/photos/invalid", takenAt },
    ]),
    ...["", null, 42].flatMap((value) => [
      [{ id: "https://example.org/photos/invalid", make: value }],
      [{ id: "https://example.org/photos/invalid", model: value }],
    ]),
    ...[
      null,
      [],
      {},
      { latitude: "0", longitude: 0 },
      { latitude: NaN, longitude: 0 },
      { latitude: 91, longitude: 0 },
      { latitude: 0 },
      { latitude: 0, longitude: Infinity },
      { latitude: 0, longitude: -181 },
    ].map((gps) => [{ id: "https://example.org/photos/invalid", gps }]),
  ])("validates all metadata even if it cannot match: %j", (input) => {
    expect(() =>
      smartAlbum(input as readonly PhotoMetadata[], [{ kind: "camera", make: "none" }]),
    ).toThrow(new AlbumError("invalid-metadata"));
  });

  it("rejects duplicate IDs before filtering", () => {
    expect(() => smartAlbum([photos[0], photos[0]], [])).toThrow(
      new AlbumError("duplicate-member"),
    );
  });
});
