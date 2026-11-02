// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  parseSidecar,
  planTakeout,
  sidecarTarget,
  type TakeoutEntry,
  wallClock,
} from "../src/apps/photos/lib/data/takeout";

const sidecar = (fields: Record<string, unknown>) =>
  JSON.stringify({ photoTakenTime: { timestamp: "1556704800" }, ...fields });
const json = (path: string, text: string): TakeoutEntry => ({
  path,
  file: new Blob([text], { type: "application/json" }),
});
const image = (path: string, bytes = "jpeg", type = "image/jpeg"): TakeoutEntry => ({
  path,
  file: new Blob([bytes], { type }),
});
const root = "Takeout/Google Photos";

describe("Takeout sidecars", () => {
  it("reads date, place and caption, and ignores other JSON", () => {
    expect(
      parseSidecar(
        sidecar({
          title: "IMG_1.jpg",
          description: "  Lisbon  ",
          geoData: { latitude: 0, longitude: 0 },
          geoDataExif: { latitude: 38.72, longitude: -9.14 },
        }),
      ),
    ).toEqual({
      title: "IMG_1.jpg",
      metadata: {
        dateTimeOriginal: "2019-05-01T10:00:00.000Z",
        location: { lat: 38.72, long: -9.14 },
        description: "Lisbon",
      },
    });
    expect(
      parseSidecar(
        JSON.stringify({
          photoTakenTime: { timestamp: "later" },
          geoData: { latitude: 1, longitude: 2 },
          geoDataExif: { latitude: 3, longitude: 4 },
          description: 7,
          title: "",
        }),
      ),
    ).toEqual({ metadata: { location: { lat: 1, long: 2 } } });
    // Dates become wall-clock time in the importing device's zone, like EXIF dates.
    expect(parseSidecar(sidecar({}), "America/Los_Angeles")?.metadata.dateTimeOriginal).toBe(
      "2019-05-01T03:00:00.000Z",
    );
    expect(wallClock(new Date("2019-12-31T23:30:00Z"), "Asia/Tokyo")).toBe(
      "2020-01-01T08:30:00.000Z",
    );
    expect(parseSidecar(JSON.stringify({ geoData: "x", photoTakenTime: {} }))).toEqual({
      metadata: {},
    });
    expect(parseSidecar("{")).toBeUndefined();
    expect(parseSidecar("[]")).toBeUndefined();
    expect(parseSidecar(JSON.stringify({ title: "album" }))).toBeUndefined();
  });
  it("finds the media name behind numbered, supplemental and shortened sidecar names", () => {
    expect(sidecarTarget("IMG_1.jpg.json")).toEqual({ base: "IMG_1.jpg", index: "" });
    expect(sidecarTarget("IMG_1.jpg(2).json")).toEqual({ base: "IMG_1.jpg", index: "(2)" });
    expect(sidecarTarget("IMG_1.jpg.supplemental-metadata.json")).toEqual({
      base: "IMG_1.jpg",
      index: "",
    });
    expect(sidecarTarget("IMG_1.jpg.supplemental-met.json").base).toBe("IMG_1.jpg");
    expect(sidecarTarget("IMG_1.jpg.s.json").base).toBe("IMG_1.jpg");
  });
});

describe("planning a Takeout import", () => {
  it("pairs photos with sidecars, builds albums once and counts what is left out", async () => {
    const long = "PXL_20190501_100000123_a_very_long_file_name.jpg"; // 48 characters
    const plan = await planTakeout([
      // A year folder: one plain, one numbered duplicate, one edited copy, one shortened.
      image(`${root}/Photos from 2019/IMG_1.jpg`, "one"),
      json(`${root}/Photos from 2019/IMG_1.jpg.json`, sidecar({ description: "First" })),
      image(`${root}/Photos from 2019/IMG_1(1).jpg`, "two"),
      json(`${root}/Photos from 2019/IMG_1.jpg(1).json`, sidecar({})),
      image(`${root}/Photos from 2019/IMG_2-edited.jpg`, "edited"),
      json(`${root}/Photos from 2019/IMG_2.jpg.supplemental-metadata.json`, sidecar({})),
      image(`${root}/Photos from 2019/${long}`, "long"),
      json(`${root}/Photos from 2019/${long.slice(0, 43)}.json`, sidecar({})),
      image(`${root}/Photos from 2019/IMG_3.HEIC`, "heic", ""),
      image(`${root}/Photos from 2019/IMG_4.png`, "nosidecar", "image/png"),
      json(`${root}/Photos from 2019/metadata.json`, JSON.stringify({ title: "Photos from 2019" })),
      // An album folder holding a copy of IMG_1 (without its sidecar) and a new photo.
      image(`${root}/Lisbon trip/IMG_1.jpg`, "one"),
      image(`${root}/Lisbon trip/IMG_5.jpg`, "five"),
      json(`${root}/Lisbon trip/IMG_5.jpg.json`, sidecar({})),
      json(`${root}/Lisbon trip/metadata.json`, JSON.stringify({ title: " Lisbon " })),
      // Another album reusing the same title merges; an unreadable one is not an album.
      image(`${root}/Lisbon trip(1)/IMG_6.jpg`, "six"),
      json(`${root}/Lisbon trip(1)/metadata.json`, JSON.stringify({ title: "Lisbon" })),
      image(`${root}/Broken/IMG_7.jpg`, "seven"),
      json(`${root}/Broken/metadata.json`, "{"),
      json(`${root}/Broken/shared_album_comments.json`, "[]"),
      json(`${root}/Broken/huge.json`, "x".repeat(1024 * 1024 + 1)),
      // Empty albums are dropped; videos and other files are counted.
      json(`${root}/Empty/metadata.json`, JSON.stringify({ title: "Empty" })),
      image(`${root}/Lisbon trip/VID_1.MP4`, "video", "video/mp4"),
      image("archive_browser.html", "<html>", "text/html"),
      image("Takeout/README", "text", "text/plain"),
      image("", "nameless", ""),
      // Deleted photos in Takeout's bin are counted and left out.
      image(`${root}/Trash/IMG_8.jpg`, "eight"),
      json(`${root}/Trash/IMG_8.jpg.json`, sidecar({})),
      image(`${root}/Bin/VID_2.mp4`, "video", "video/mp4"),
      image(`${root}/Bin/notes.txt`, "text", "text/plain"),
      // Two shortened sidecars could fit; the longest (most specific) wins.
      json(`${root}/Photos from 2019/${long.slice(0, 42)}.json`, sidecar({ description: "Short" })),
    ]);
    const byName = new Map(plan.items.map((item) => [item.name, item]));
    expect([...byName.keys()].sort()).toEqual(
      [
        "IMG_1(1).jpg",
        "IMG_1.jpg",
        "IMG_2-edited.jpg",
        "IMG_3.HEIC",
        "IMG_4.png",
        "IMG_5.jpg",
        "IMG_6.jpg",
        "IMG_7.jpg",
        long,
      ].sort(),
    );
    expect(byName.get("IMG_1.jpg")?.metadata).toEqual({
      dateTimeOriginal: "2019-05-01T10:00:00.000Z",
      description: "First",
    });
    for (const name of ["IMG_1(1).jpg", "IMG_2-edited.jpg", long, "IMG_5.jpg"])
      expect(byName.get(name)?.metadata?.dateTimeOriginal).toBe("2019-05-01T10:00:00.000Z");
    expect(byName.get("IMG_4.png")?.metadata).toBeUndefined();
    expect(byName.get("IMG_3.HEIC")?.file.type).toBe("image/heic");
    expect(plan.albums).toEqual([
      {
        title: "Lisbon",
        keys: [
          byName.get("IMG_1.jpg")?.key,
          byName.get("IMG_5.jpg")?.key,
          byName.get("IMG_6.jpg")?.key,
        ],
      },
    ]);
    expect(byName.get(long)?.metadata?.description).toBeUndefined();
    expect(plan).toMatchObject({
      withDetails: 5,
      videos: 1,
      unsupported: 3,
      duplicates: 1,
      trashed: 2,
    });
  });

  it("pairs files whose own names end in a number in brackets", async () => {
    const long = "PXL_20190501_100000123_a_very_long_file_name(1).jpg";
    const plan = await planTakeout(
      [
        image("Year/image (1).jpg", "web"),
        json("Year/image (1).jpg.json", sidecar({ description: "From the web" })),
        image("Year/IMG_2(1).jpg", "dup"),
        json("Year/IMG_2.jpg(1).json", sidecar({ description: "Duplicate" })),
        // A long duplicate must not take the original's shortened sidecar.
        image(`Year/${long}`, "long"),
        json(`Year/${long.slice(0, 43)}.json`, sidecar({ description: "Original" })),
      ],
      { timeZone: "UTC" },
    );
    const byName = new Map(plan.items.map((item) => [item.name, item]));
    expect(byName.get("image (1).jpg")?.metadata?.description).toBe("From the web");
    expect(byName.get("IMG_2(1).jpg")?.metadata?.description).toBe("Duplicate");
    expect(byName.get(long)?.metadata).toBeUndefined();
  });

  it("takes the sidecar from a later copy when the first copy had none", async () => {
    const plan = await planTakeout([
      image("A album/IMG_9.jpg", "nine"),
      json("A album/metadata.json", JSON.stringify({ title: "A" })),
      image("B year/IMG_9.jpg", "nine"),
      json("B year/IMG_9.jpg.json", sidecar({})),
      image("B year/IMG_9.jpg", "nine"),
    ]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.metadata?.dateTimeOriginal).toBe("2019-05-01T10:00:00.000Z");
    expect(plan).toMatchObject({ withDetails: 1, duplicates: 2 });
    expect(plan.albums[0]?.keys).toEqual([plan.items[0]?.key]);
  });
});
