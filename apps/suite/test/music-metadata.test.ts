// AUTHORED-BY Codex GPT-6.1-Sol
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
  text,
  uint32,
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

  it("prefers ID3v2 over conflicting ID3v1 tags", async () => {
    const legacy = id3v1();
    legacy.fill(0, 3, 33);
    legacy.set(text("Earlier fictional title"), 3);
    expect(await extractAudioMetadata(join(id3(4), mpeg(), legacy).buffer)).toMatchObject(
      taggedWithoutDuration(),
    );
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
