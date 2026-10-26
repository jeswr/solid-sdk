// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { UnexpectedFileContentError } from "music-metadata";
import { describe, expect, it, vi } from "vitest";
import { type AudioMetadata, extractAudioMetadata } from "../src/apps/music/lib/metadata";
import {
  atom,
  flac,
  id3,
  id3v1,
  join,
  mp4,
  mpeg,
  ogg,
  png,
  syncsafe,
  text,
  uint32,
  unsynchronisedId3v23,
} from "./music-metadata-fixtures";

const tagged: AudioMetadata = {
  title: "Paper Moon",
  artist: "Mira Example",
  album: "Fictional Skies",
  track: 7,
  disc: 2,
  year: 2024,
  duration: 2,
  coverArtMime: "image/png",
};
const missing: AudioMetadata = {
  title: null,
  artist: null,
  album: null,
  track: null,
  disc: null,
  year: null,
  duration: null,
  coverArtMime: null,
};

describe("extractAudioMetadata", () => {
  it.each([
    3, 4,
  ] as const)("reads every requested ID3v2.%i field and MPEG duration", async (version) => {
    const result = await extractAudioMetadata(join(id3(version), mpeg()).buffer);
    expect(result).toEqual({ ...tagged, duration: expect.any(Number) });
    expect(result.duration).toBeCloseTo((4 * 1152) / 44100, 5);
  });

  it.each([
    [0, "Café"],
    [1, "Café 🌙"],
    [2, "Café 🌙"],
    [3, "Café 🌙"],
  ] as const)("decodes non-ASCII ID3 text encoding %i", async (encoding, title) => {
    expect(
      await extractAudioMetadata(join(id3(4, encoding, true, title), mpeg()).buffer),
    ).toMatchObject({
      title,
      artist: tagged.artist,
      album: tagged.album,
    });
  });

  it("reads unsynchronised ID3v2.3 UTF-16 tags without changing the input or audio boundary", async () => {
    const legacy = id3v1();
    legacy.set(text("1999"), 93);
    legacy[126] = 9;
    const fixture = join(unsynchronisedId3v23(), mpeg(), legacy);
    const before = fixture.slice();
    for (let read = 0; read < 2; read++) {
      const result = await extractAudioMetadata(fixture.buffer);
      expect(result).toEqual({ ...tagged, duration: expect.any(Number) });
      expect(result.duration).toBeCloseTo((4 * 1152) / 44100, 5);
      expect(fixture).toEqual(before);
    }
  });

  it.each([
    [0xff, 0, 0, 0xff, 0xe0, 0xff, 0x12, 0xff],
    [0xff, 0],
    [0x12],
  ])("decodes unsynchronised binary data including zero and terminal FF bytes %j", async (...bytes) => {
    const body = join(
      text("PRIV"),
      uint32(bytes.length),
      new Uint8Array(2),
      new Uint8Array(bytes),
      id3(3).subarray(10),
    );
    const tail = join(text("ID3"), new Uint8Array([3, 0, 0]), syncsafe(body.length), body);
    const fixture = join(unsynchronisedId3v23(id3(3)), unsynchronisedId3v23(tail), mpeg());
    expect(await extractAudioMetadata(fixture.buffer)).toMatchObject(taggedWithoutDuration());
  });

  it("restores escapes inside frame sizes and preserves literal FF sequences in Latin-1 text", async () => {
    for (const title of ["x".repeat(254), "Café ÿà ÿx"]) {
      const tag = unsynchronisedId3v23(id3(3, 0, true, title));
      expect(await extractAudioMetadata(join(tag, mpeg()).buffer)).toMatchObject({
        ...taggedWithoutDuration(),
        title,
      });
    }
  });

  it("preserves an unescaped FF at a tag boundary without consuming the MPEG sync byte", async () => {
    const body = join(text("PRIV"), uint32(1), new Uint8Array(2), new Uint8Array([0xff]));
    const tag = join(text("ID3"), new Uint8Array([3, 0, 0x80]), syncsafe(body.length), body);
    const result = await extractAudioMetadata(join(tag, mpeg()).buffer);
    expect(result.duration).toBeCloseTo((4 * 1152) / 44100, 5);
  });

  it.each([
    "size",
    "truncated",
    "extended header",
  ])("rejects unsupported unsynchronised ID3v2.3 %s with a typed error", async (damage) => {
    const original = id3(3);
    if (damage === "extended header") original[5] = 0x40;
    const tag = unsynchronisedId3v23(
      damage === "extended header"
        ? join(original.subarray(0, 10), uint32(6), new Uint8Array(6), original.subarray(10))
        : original,
    );
    if (damage === "size") tag[6] = 0x80;
    if (damage === "truncated") tag.set(syncsafe(tag.length), 6);
    await expect(extractAudioMetadata(tag.buffer)).rejects.toBeInstanceOf(
      UnexpectedFileContentError,
    );
  });

  it.each([
    3, 4,
  ] as const)("skips linked ID3v2.%i pictures and selects the first embedded MIME", async (version) => {
    const pictures = [
      { mime: "-->", data: text("https://example.org/cover.png") },
      { mime: "image/png", data: png },
      { mime: "image/jpeg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
    ];
    const fetch = vi.fn(() => {
      throw new Error("Unexpected artwork fetch");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      for (const [entries, expected] of [
        [pictures, "image/png"],
        [pictures.slice(0, 1), null],
      ] as const) {
        const fixture = join(id3(version, undefined, true, undefined, undefined, entries), mpeg());
        expect(await extractAudioMetadata(fixture.buffer)).toMatchObject({
          coverArtMime: expected,
        });
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads ID3v1.1 and reports fields that ID3v1 cannot express as null", async () => {
    expect(await extractAudioMetadata(join(mpeg(), id3v1()).buffer)).toEqual({
      ...tagged,
      disc: null,
      duration: expect.any(Number),
      coverArtMime: null,
    });
  });

  it("reads ID3v1.0 without interpreting its comment as a track", async () => {
    expect(await extractAudioMetadata(join(mpeg(), id3v1(false)).buffer)).toMatchObject({
      title: tagged.title,
      track: null,
    });
  });

  it.each([3, 4] as const)("prefers ID3v2.%i over conflicting ID3v1 tags", async (version) => {
    const legacy = id3v1();
    legacy.fill(0, 3, 33);
    legacy.set(text("Earlier fictional title"), 3);
    legacy.set(text("1999"), 93);
    legacy[126] = 9;
    expect(await extractAudioMetadata(join(id3(version), mpeg(), legacy).buffer)).toMatchObject(
      taggedWithoutDuration(),
    );
  });

  it.each([
    3, 4,
  ] as const)("uses ID3v1 track and year when ID3v2.%i omits them", async (version) => {
    const modern = id3(version, undefined, true, undefined, {});
    expect(await extractAudioMetadata(join(modern, mpeg(), id3v1()).buffer)).toMatchObject(
      taggedWithoutDuration(),
    );
  });

  it.each([
    [{ track: "7/12" }, { track: 7, year: 1999 }],
    [{ year: "2024-05-06" }, { track: 9, year: 2024 }],
    [
      { track: "invalid", year: "invalid" },
      { track: 9, year: 1999 },
    ],
  ])("falls back to ID3v1 separately for missing or invalid ID3v2 numbers %j", async (numbers, expected) => {
    for (const version of [3, 4] as const) {
      const modern = id3(version, undefined, true, undefined, numbers);
      const legacy = id3v1();
      legacy.set(text("1999"), 93);
      legacy[126] = 9;
      expect(await extractAudioMetadata(join(modern, mpeg(), legacy).buffer)).toMatchObject(
        expected,
      );
    }
  });

  it.each([
    3, 4,
  ] as const)("returns null for invalid ID3v2.%i years without a valid legacy year", async (version) => {
    const modern = id3(version, undefined, true, undefined, { year: "invalid" });
    expect(await extractAudioMetadata(join(modern, mpeg()).buffer)).toMatchObject({ year: null });
    const legacy = id3v1();
    legacy.set(text("oops"), 93);
    expect(await extractAudioMetadata(join(modern, mpeg(), legacy).buffer)).toMatchObject({
      year: null,
    });
  });

  it.each([
    "ARTIST",
    "ARTISTS",
  ] as const)("returns the first artist from repeated FLAC %s tags", async (artistTag) => {
    expect(
      await extractAudioMetadata(flac(true, true, BigInt(88200), artistTag).buffer),
    ).toMatchObject({ artist: "Mira Example" });
  });

  it("reads FLAC Vorbis comments, STREAMINFO duration and PICTURE MIME", async () => {
    expect(await extractAudioMetadata(flac().buffer)).toEqual(tagged);
  });

  it("reads Ogg Vorbis comments, final granule duration and comment artwork MIME", async () => {
    expect(await extractAudioMetadata(ogg().buffer)).toEqual(tagged);
  });

  it("reads MP4 atoms including track/disc pairs, date, duration and artwork", async () => {
    expect(await extractAudioMetadata(mp4().buffer)).toEqual({ ...tagged, duration: 2.5 });
  });

  it("represents absent fields as null", async () => {
    expect(await extractAudioMetadata(flac(false).buffer)).toEqual({ ...missing, duration: 2 });
    expect(await extractAudioMetadata(mp4(false).buffer)).toEqual({ ...missing, duration: 2.5 });
    expect(await extractAudioMetadata(mpeg().buffer)).toEqual({
      ...missing,
      duration: expect.any(Number),
    });
  });

  it("keeps an unknown duration null", async () => {
    expect(await extractAudioMetadata(flac(true, true, BigInt(0)).buffer)).toEqual({
      ...tagged,
      duration: null,
    });
  });

  it("returns partial metadata when a recognized FLAC container is truncated", async () => {
    expect(await extractAudioMetadata(text("fLaC").buffer)).toEqual(missing);
  });

  it.each([
    ["ID3", () => join(id3(4, 3, false), mpeg())],
    ["FLAC", () => flac(true, false)],
    ["Ogg", () => ogg(false)],
  ] as const)("allows %s tags without artwork", async (_name, fixture) => {
    expect(await extractAudioMetadata(fixture().buffer)).toMatchObject({
      ...taggedWithoutDuration(),
      coverArtMime: null,
    });
  });

  it("does not mutate or detach its input and does not access the network", async () => {
    const fixture = flac();
    const before = fixture.slice();
    const fetch = vi.fn(() => {
      throw new Error("Unexpected network access");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      expect(await extractAudioMetadata(fixture.buffer)).toEqual(tagged);
      expect(await extractAudioMetadata(fixture.buffer)).toEqual(tagged);
      expect(fixture).toEqual(before);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    new ArrayBuffer(0),
    text("https://example.org/not-audio").buffer,
  ])("rejects unsupported or unreadable bytes", async (buffer) => {
    await expect(extractAudioMetadata(buffer)).rejects.toBeInstanceOf(Error);
  });

  it("terminates on a truncated MP4 atom instead of following its declared size", async () => {
    const fixture = join(
      atom("ftyp", text("M4A "), uint32(0), text("M4A isom")),
      uint32(4096),
      text("moov"),
    );
    await expect(extractAudioMetadata(fixture.buffer)).rejects.toThrow(
      "Atom size exceeds remaining bytes",
    );
  });
});

function taggedWithoutDuration() {
  const { duration: _duration, ...rest } = tagged;
  return rest;
}
