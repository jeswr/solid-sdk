// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import type { TakeoutItem, TakeoutPlan } from "../src/apps/photos/lib/data/takeout";
import {
  importTakeoutPlan,
  STOP_AFTER_FAILED_BATCHES,
  TAKEOUT_BATCH,
  type TakeoutFailure,
  takeoutFailure,
} from "../src/apps/photos/lib/data/takeout-import";

const pod: TakeoutFailure = { kind: "pod" };

const item = (name: string, metadata?: TakeoutItem["metadata"]): TakeoutItem => ({
  key: `${name}\u00001`,
  name,
  path: `Takeout/${name}`,
  file: new Blob(["x"], { type: "image/jpeg" }),
  metadata,
});
const plan = (items: TakeoutItem[], albums: TakeoutPlan["albums"] = []): TakeoutPlan => ({
  items,
  albums,
  withDetails: 0,
  videos: 0,
  unsupported: 0,
  duplicates: 2,
  trashed: 0,
});

describe("importing a Takeout plan", () => {
  it("uploads in batches, reports progress and files saved photos into albums", async () => {
    const items = Array.from({ length: 5 }, (_, n) => item(`IMG_${n}.jpg`));
    const [a, b, c, d, e] = items.map((value) => value.key) as string[];
    const upload = vi.fn(async (batch: readonly TakeoutItem[]) =>
      batch.map((value) => `https://pod/${value.name}#it`),
    );
    const addToAlbum = vi.fn(async () => true);
    const createAlbum = vi.fn(async () => true);
    const progress: [number, number][] = [];
    const onAlbums = vi.fn();
    const result = await importTakeoutPlan(
      plan(items, [
        { title: "Lisbon", keys: [a as string, b as string] },
        { title: "Porto", keys: [c as string, d as string, e as string] },
      ]),
      {
        upload,
        findAlbum: (title) => (title === "Lisbon" ? "https://pod/albums/lisbon.ttl" : undefined),
        addToAlbum,
        createAlbum,
        onProgress: (done, total) => progress.push([done, total]),
        onAlbums,
      },
      2,
    );
    expect(upload.mock.calls.map(([batch]) => batch.length)).toEqual([2, 2, 1]);
    expect(progress).toEqual([
      [0, 5],
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
    expect(addToAlbum).toHaveBeenCalledWith("https://pod/albums/lisbon.ttl", "Lisbon", [
      "https://pod/IMG_0.jpg#it",
      "https://pod/IMG_1.jpg#it",
    ]);
    expect(createAlbum).toHaveBeenCalledWith("Porto", [
      "https://pod/IMG_2.jpg#it",
      "https://pod/IMG_3.jpg#it",
      "https://pod/IMG_4.jpg#it",
    ]);
    expect(onAlbums).toHaveBeenCalledOnce();
    expect(result).toEqual({ saved: 5, albums: 2, failedAlbums: 0, unreadable: [] });
    expect(TAKEOUT_BATCH).toBeGreaterThan(1);
  });

  it("returns failed photos with their albums for a retry, and counts album failures", async () => {
    const dated = item("B.jpg", { dateTimeOriginal: "2019-05-01T10:00:00.000Z" });
    const items = [item("A.jpg"), dated, item("C.jpg", {})];
    const [a, b, c] = items.map((value) => value.key) as [string, string, string];
    const result = await importTakeoutPlan(
      plan(items, [
        { title: "Saved only", keys: [a] },
        { title: "Mixed", keys: [a, b] },
        { title: "Failed only", keys: [c] },
      ]),
      {
        upload: async (batch) => batch.map((value) => (value.name === "A.jpg" ? "a#it" : pod)),
        findAlbum: () => undefined,
        addToAlbum: async () => true,
        createAlbum: async (title) => title !== "Mixed",
      },
    );
    expect(result).toMatchObject({ saved: 1, albums: 1, failedAlbums: 1 });
    expect(result.retry).toEqual({
      ...plan(
        [dated, items[2] as TakeoutItem],
        [
          { title: "Mixed", keys: [b] },
          { title: "Failed only", keys: [c] },
        ],
      ),
      withDetails: 1,
      duplicates: 0,
    });
  });

  it("skips albums when none of their photos saved", async () => {
    const one = item("A.jpg");
    const createAlbum = vi.fn(async () => true);
    const result = await importTakeoutPlan(plan([one], [{ title: "Lost", keys: [one.key] }]), {
      // A short answer counts the missing photos as pod failures.
      upload: async () => [],
      findAlbum: () => undefined,
      addToAlbum: async () => true,
      createAlbum,
    });
    expect(createAlbum).not.toHaveBeenCalled();
    expect(result).toMatchObject({ saved: 0, albums: 0, failedAlbums: 0 });
    expect(result.retry?.items).toEqual([one]);
  });

  it("stops after batches that save nothing and keeps the rest for a retry", async () => {
    const items = Array.from({ length: 10 }, (_, n) => item(`IMG_${n}.jpg`));
    const upload = vi.fn(async (batch: readonly TakeoutItem[]) =>
      batch.map((value) => (value.name === "IMG_0.jpg" ? "zero#it" : pod)),
    );
    const onAlbums = vi.fn();
    const result = await importTakeoutPlan(
      plan(items),
      {
        upload,
        findAlbum: () => undefined,
        addToAlbum: async () => true,
        createAlbum: async () => true,
        onAlbums,
      },
      2,
    );
    // The first batch saved one photo; then three empty batches stop the import.
    expect(upload).toHaveBeenCalledTimes(1 + STOP_AFTER_FAILED_BATCHES);
    expect(onAlbums).not.toHaveBeenCalled();
    expect(result).toMatchObject({ saved: 1, stopped: true });
    expect(result.retry?.items).toEqual(items.slice(1));
  });

  it("leaves photos that can't be read out of the retry, and doesn't stop for them", async () => {
    const items = Array.from({ length: 8 }, (_, n) => item(`IMG_${n}.heic`));
    const upload = vi.fn(async (batch: readonly TakeoutItem[]) =>
      batch.map((value): string | TakeoutFailure =>
        value.name === "IMG_7.heic" ? pod : { kind: "photo", reason: `Can't read ${value.name}` },
      ),
    );
    const result = await importTakeoutPlan(
      plan(items),
      {
        upload,
        findAlbum: () => undefined,
        addToAlbum: async () => true,
        createAlbum: async () => true,
      },
      2,
    );
    expect(upload).toHaveBeenCalledTimes(4);
    expect(result.stopped).toBeUndefined();
    expect(result.unreadable).toHaveLength(7);
    expect(result.unreadable[0]).toEqual({
      key: "IMG_0.heic\u00001",
      name: "IMG_0.heic",
      reason: "Can't read IMG_0.heic",
    });
    expect(result.retry?.items.map((value) => value.name)).toEqual(["IMG_7.heic"]);
  });

  it("sorts upload errors into pod problems and photos this browser can't import", () => {
    expect(
      takeoutFailure(Object.assign(new Error("x"), { status: 503 }), "image/jpeg", true),
    ).toEqual(pod);
    for (const status of [408, 429])
      expect(takeoutFailure({ status }, "image/jpeg", true)).toEqual(pod);
    expect(takeoutFailure(new TypeError("Failed to fetch"), "image/jpeg", true)).toEqual(pod);
    expect(
      takeoutFailure(new TypeError("NetworkError when attempting"), "image/png", false),
    ).toEqual(pod);
    expect(takeoutFailure({ status: 413 }, "image/jpeg", true)).toEqual({
      kind: "photo",
      reason: "Your pod refused this photo (error 413).",
    });
    expect(
      takeoutFailure(new TypeError("Unsupported image media type"), "image/gif", true),
    ).toEqual({ kind: "photo", reason: "This browser couldn't read this photo." });
    expect(takeoutFailure(new Error("decode"), "image/heic", true)).toMatchObject({
      kind: "photo",
      reason: expect.stringContaining("Turn off Remove location"),
    });
    expect(takeoutFailure(new Error("decode"), "image/heic", false)).toEqual({
      kind: "photo",
      reason: "This browser couldn't read this photo.",
    });
  });
});
