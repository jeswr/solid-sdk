// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  createNameComparator,
  formatDuration,
  groupAlbums,
  groupArtists,
  type LibraryTrack,
  MusicLibraryError,
  type MusicLibraryErrorCode,
  mostPlayed,
  type NameSortOptions,
  orderTracks,
  type PlayEvent,
  type PlayWindow,
  recentlyPlayed,
  sortName,
  totalDuration,
  VARIOUS_ARTISTS,
} from "../src/apps/music/lib/library";

const albumId = "https://example.org/albums/paper-moons";
function track(id: string, changes: Partial<LibraryTrack> = {}): LibraryTrack {
  return {
    id: `https://example.org/tracks/${id}`,
    title: `Song ${id}`,
    artist: "The Paper Kites of Orin",
    albumId,
    albumTitle: "The Paper Moons",
    durationSeconds: 60,
    ...changes,
  };
}

function fails(operation: () => unknown, code: MusicLibraryErrorCode): void {
  expect(operation).toThrow(MusicLibraryError);
  expect(operation).toThrow(expect.objectContaining({ name: "MusicLibraryError", code }));
}

describe("music sort names", () => {
  it("strips one configurable leading article without changing display text", () => {
    for (const article of ["The", "A", "An", "tHe"]) {
      expect(sortName(`${article} Lantern`)).toBe("Lantern");
    }
    expect(sortName("The The Lantern")).toBe("The Lantern");
    expect(sortName("The   Lantern")).toBe("Lantern");
    for (const name of ["The", "Theremin", "A-ha", "Another", "In The Lantern", "Le Phare"]) {
      expect(sortName(name)).toBe(name);
    }
    expect(sortName("The Lantern", { articles: [] })).toBe("The Lantern");
    expect(sortName("Le Phare", { articles: ["le"] })).toBe("Phare");
    expect(sortName("A Lantern", { articles: ["The"] })).toBe("A Lantern");
  });

  it("uses numeric Intl collation, locale accents, and deterministic spelling ties", () => {
    const compare = createNameComparator();
    expect(["The Song 10", "Song 2", "A Song 1"].sort(compare)).toEqual([
      "A Song 1",
      "Song 2",
      "The Song 10",
    ]);
    expect(["Écho", "Echo", "echo"].sort(compare)).toEqual(["Echo", "echo", "Écho"]);
    expect(compare("Same", "Same")).toBe(0);
    expect(compare("Echo", "Écho")).toBeLessThan(0);
    expect(compare("Écho", "Echo")).toBeGreaterThan(0);
    expect(compare("The Echo", "Echo")).toBeGreaterThan(0);
    expect(createNameComparator({ locale: "sv" })("Ängel", "Zebra")).toBeGreaterThan(0);
    expect(createNameComparator({ locale: "de" })("Ängel", "Zebra")).toBeLessThan(0);
  });

  it.each([
    "",
    " ",
    " The Moon",
    "Moon ",
    "Moon\nLight",
    "\ud800",
    5,
    null,
  ])("rejects invalid sort name %j", (name) => {
    fails(() => sortName(name as string), "invalid-name");
    fails(() => createNameComparator()("Valid", name as string), "invalid-name");
  });

  it.each([
    null,
    [],
    "en",
    { locale: null },
    { locale: 4 },
    { locale: "" },
    { locale: "en_XX" },
    { locale: "zz" },
    { articles: null },
    { articles: "The" },
    { articles: ["two words"] },
    { articles: [""] },
    { articles: [4] },
  ])("rejects invalid options even for empty groups: %j", (options) => {
    fails(() => createNameComparator(options as NameSortOptions), "invalid-options");
    fails(() => groupAlbums([], options as NameSortOptions), "invalid-options");
  });
});

describe("music album and artist grouping", () => {
  it("groups by album identity, falls back to artist, orders discs/tracks and totals durations", () => {
    const input = [
      track("d2t1", { discNumber: 2, trackNumber: 1 }),
      track("d1t2", { trackNumber: 2 }),
      track("d1t1", { discNumber: 1, trackNumber: 1 }),
      track("unknown"),
      track("other", { albumId: "https://example.org/albums/second-edition" }),
    ];
    const albums = groupAlbums(input);
    expect(albums).toHaveLength(2);
    expect(albums[0]).toMatchObject({
      id: albumId,
      artist: input[0]?.artist,
      compilation: false,
      durationSeconds: 240,
    });
    expect(albums[0]?.tracks.map((item) => item.id)).toEqual([
      input[2]?.id,
      input[1]?.id,
      input[3]?.id,
      input[0]?.id,
    ]);
    expect(albums[1]?.tracks).toEqual([input[4]]);
    expect(groupAlbums([...input].reverse())).toEqual(albums);
    expect(groupArtists(input)).toEqual([
      {
        name: "The Paper Kites of Orin",
        albumIds: [albumId, "https://example.org/albums/second-edition"],
        tracks: [...(albums[0]?.tracks ?? []), input[4]],
        durationSeconds: 300,
      },
    ]);
    expect(input.map((item) => item.id)).toEqual(
      ["d2t1", "d1t2", "d1t1", "unknown", "other"].map((id) => `https://example.org/tracks/${id}`),
    );
  });

  it("uses album artist for guest tracks and detects compilations with and without credits", () => {
    const solo = track("solo", { albumArtist: "Mira Quill" });
    const guest = track("guest", { artist: "Oren Vale" });
    expect(groupAlbums([solo, guest])[0]).toMatchObject({
      artist: "Mira Quill",
      compilation: false,
    });
    expect(groupAlbums([guest, solo])).toEqual(groupAlbums([solo, guest]));
    const compilation = groupAlbums([track("a"), guest])[0];
    expect(compilation).toMatchObject({ artist: VARIOUS_ARTISTS, compilation: true });
    expect(groupAlbums([track("c", { albumArtist: "various artists" })])[0]).toMatchObject({
      artist: "various artists",
      compilation: true,
    });
    expect(groupArtists([track("a"), guest]).map((artist) => artist.name)).toEqual([
      "Oren Vale",
      "The Paper Kites of Orin",
    ]);
  });

  it("sorts albums and artists by configurable names without folding identities", () => {
    const input = [
      track("z", { albumId: "z", albumTitle: "The Zebra", artist: "The Zebra Players" }),
      track("b", { albumId: "b", albumTitle: "A Beacon", artist: "A Beacon Choir" }),
      track("a", { albumId: "a", albumTitle: "A Beacon", artist: "A Beacon Choir" }),
      track("c", { albumId: "c", albumTitle: "A Beacon", artist: "An Apple Choir" }),
      track("d", { albumId: "d", albumTitle: "A Beacon", artist: "a beacon choir" }),
    ];
    expect(groupAlbums(input).map((album) => album.id)).toEqual(["c", "a", "b", "d", "z"]);
    expect(groupAlbums([...input].reverse())).toEqual(groupAlbums(input));
    expect(groupArtists(input).map((artist) => artist.name)).toEqual([
      "An Apple Choir",
      "A Beacon Choir",
      "a beacon choir",
      "The Zebra Players",
    ]);
    expect(groupArtists(input, { articles: [] }).map((artist) => artist.name)).toEqual([
      "A Beacon Choir",
      "a beacon choir",
      "An Apple Choir",
      "The Zebra Players",
    ]);
  });

  it("orders equal positions by name then ID, missing positions last, without mutating inputs", () => {
    const input = [
      track("z", { title: "Song 2" }),
      track("b", { title: "Song 1" }),
      track("a", { title: "Song 1" }),
      track("n", { trackNumber: 1 }),
      track("d", { discNumber: 2, trackNumber: 1 }),
    ];
    for (const item of input) Object.freeze(item);
    Object.freeze(input);
    expect(orderTracks(input).map((item) => item.id)).toEqual([
      input[3]?.id,
      input[2]?.id,
      input[1]?.id,
      input[0]?.id,
      input[4]?.id,
    ]);
    expect(orderTracks([...input].reverse())).toEqual(orderTracks(input));
    expect(groupAlbums(input)[0]?.tracks).toEqual(orderTracks(input));
    expect(groupArtists(input)[0]?.tracks).toEqual(orderTracks(input));
  });

  it("handles empty groups and unknown durations", () => {
    expect(groupAlbums([])).toEqual([]);
    expect(groupArtists([])).toEqual([]);
    expect(orderTracks([])).toEqual([]);
    const unknown = track("a", { durationSeconds: undefined });
    expect(groupAlbums([unknown])[0]?.durationSeconds).toBeUndefined();
    expect(groupArtists([unknown])[0]?.durationSeconds).toBeUndefined();
  });

  it("rejects conflicting album titles or explicit album credits", () => {
    for (const changes of [{ albumTitle: "Another release" }, { albumArtist: "Oren Vale" }]) {
      const input = [track("a", { albumArtist: "Mira Quill" }), track("b", changes)];
      fails(() => groupAlbums(input), "conflicting-album");
      fails(() => groupArtists(input), "conflicting-album");
    }
  });

  it.each([
    null,
    {},
    "tracks",
    [null],
    [[]],
    [4],
    [undefined],
    ...["id", "title", "artist", "albumId", "albumTitle", "albumArtist"].flatMap((field) =>
      [null, 3, "", " ", " padded", "bad\u0000name", "\udfff"].map((value) => [
        track("a", { [field]: value }),
      ]),
    ),
    ...["discNumber", "trackNumber"].flatMap((field) =>
      [null, 0, -1, 1.5, NaN, Infinity, "2", Number.MAX_SAFE_INTEGER + 1].map((value) => [
        track("a", { [field]: value }),
      ]),
    ),
  ])("rejects malformed tracks: %j", (input) => {
    fails(() => groupAlbums(input as readonly LibraryTrack[]), "invalid-track");
  });

  it("rejects duplicate track identities without echoing input metadata", () => {
    const duplicate = [track("private-title"), track("private-title")];
    for (const operation of [groupAlbums, groupArtists, orderTracks, totalDuration]) {
      fails(() => operation(duplicate), "duplicate-track");
    }
    expect(new MusicLibraryError("duplicate-track").message).toBe("Music library: duplicate-track");
  });
});

describe("music duration totals and formatting", () => {
  it.each([
    [undefined, "—"],
    [0, "0:00"],
    [5, "0:05"],
    [59, "0:59"],
    [60, "1:00"],
    [185, "3:05"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3729, "1:02:09"],
    [86400, "24:00:00"],
    [Number.MAX_SAFE_INTEGER, "2501999792983:36:31"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("sums safely, with zero for empty and unknown for missing values", () => {
    expect(totalDuration([])).toBe(0);
    expect(totalDuration([track("a", { durationSeconds: 0 }), track("b")])).toBe(60);
    expect(totalDuration([track("a", { durationSeconds: Number.MAX_SAFE_INTEGER })])).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(totalDuration([track("a", { durationSeconds: undefined }), track("b")])).toBeUndefined();
    for (const first of [0, undefined]) {
      fails(
        () =>
          totalDuration([
            track("u", { durationSeconds: first }),
            track("a", { durationSeconds: Number.MAX_SAFE_INTEGER }),
            track("b"),
          ]),
        "duration-overflow",
      );
    }
  });

  it.each([
    null,
    "60",
    -1,
    0.1,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid durations, even after an unknown duration: %j", (value) => {
    fails(() => formatDuration(value as number), "invalid-duration");
    fails(
      () =>
        totalDuration([
          track("a", { durationSeconds: undefined }),
          track("b", { durationSeconds: value as number }),
        ]),
      "invalid-duration",
    );
  });
});

describe("music play log", () => {
  const tracks = [track("a"), track("b"), track("c"), track("d"), track("unplayed")];
  const play = (id: string, index: number, playedAt: number): PlayEvent => ({
    id: `https://example.org/plays/${id}`,
    trackId: (tracks[index] as LibraryTrack).id,
    playedAt,
  });
  const log = [
    play("a1", 0, 1000),
    play("b1", 1, 4000),
    play("a2", 0, 3000),
    play("c1", 2, 4000),
    play("b2", 1, 2000),
    play("d1", 3, 5000),
  ];

  it("counts every event once, coalesces tracks, and sorts recent/count ties deterministically", () => {
    expect(recentlyPlayed(tracks, log)).toEqual([
      { track: tracks[3], playCount: 1, lastPlayedAt: 5000 },
      { track: tracks[1], playCount: 2, lastPlayedAt: 4000 },
      { track: tracks[2], playCount: 1, lastPlayedAt: 4000 },
      { track: tracks[0], playCount: 2, lastPlayedAt: 3000 },
    ]);
    expect(mostPlayed(tracks, log).map((row) => row.track.id)).toEqual([
      tracks[1]?.id,
      tracks[0]?.id,
      tracks[3]?.id,
      tracks[2]?.id,
    ]);
    expect(recentlyPlayed(tracks, [...log].reverse())).toEqual(recentlyPlayed(tracks, log));
    expect(mostPlayed(tracks, [...log].reverse())).toEqual(mostPlayed(tracks, log));
    const ties = [play("c", 2, 0), play("a", 0, 0), play("b", 1, 0)];
    expect(mostPlayed(tracks, ties).map((row) => row.track.id)).toEqual(
      tracks.slice(0, 3).map((item) => item.id),
    );
  });

  it("filters half-open windows with independent bounds and handles empty ranges", () => {
    expect(recentlyPlayed(tracks, log, { from: 3000, to: 4000 })).toEqual([
      { track: tracks[0], playCount: 1, lastPlayedAt: 3000 },
    ]);
    expect(mostPlayed(tracks, log, { to: 3000 }).map((row) => row.lastPlayedAt)).toEqual([
      2000, 1000,
    ]);
    expect(mostPlayed(tracks, log, { from: 4000 }).map((row) => row.playCount)).toEqual([1, 1, 1]);
    expect(recentlyPlayed(tracks, log, { from: 3000, to: 3000 })).toEqual([]);
    expect(recentlyPlayed([], [])).toEqual([]);
    expect(mostPlayed(tracks, [])).toEqual([]);
    expect(recentlyPlayed(tracks, [play("negative", 0, -1)])[0]?.lastPlayedAt).toBe(-1);
    expect(recentlyPlayed(tracks, [play("edge", 0, 8_640_000_000_000_000)])[0]?.lastPlayedAt).toBe(
      8_640_000_000_000_000,
    );
  });

  it("leaves frozen tracks, logs and window unchanged", () => {
    const frozenTracks = Object.freeze(tracks.map((item) => Object.freeze(item)));
    const frozenLog = Object.freeze(log.map((item) => Object.freeze(item)));
    const window = Object.freeze({ from: 0 });
    expect(recentlyPlayed(frozenTracks, frozenLog, window)).toEqual(recentlyPlayed(tracks, log));
    expect(mostPlayed(frozenTracks, frozenLog, window)).toEqual(mostPlayed(tracks, log));
    expect(frozenLog[0]?.playedAt).toBe(1000);
  });

  it.each([
    null,
    [],
    3,
    { from: null },
    { to: "3000" },
    { from: NaN },
    { to: Infinity },
    { from: 0.5 },
    { to: 8_640_000_000_000_001 },
    { from: 1, to: 0 },
  ])("rejects invalid windows even for empty logs: %j", (window) => {
    fails(() => recentlyPlayed([], [], window as PlayWindow), "invalid-window");
  });

  it.each([
    null,
    {},
    [null],
    [[]],
    [4],
    [undefined],
    [play("valid", 0, NaN)],
    [play("valid", 0, Infinity)],
    [play("valid", 0, 0.5)],
    [play("valid", 0, -8_640_000_000_000_001)],
    [{ ...play("valid", 0, 0), id: "" }],
    [{ ...play("valid", 0, 0), trackId: null }],
    [{ ...play("valid", 0, 0), playedAt: "2026-10-26" }],
  ])("rejects malformed logs: %j", (input) => {
    fails(() => recentlyPlayed(tracks, input as readonly PlayEvent[]), "invalid-play");
  });

  it("rejects duplicate events and unknown tracks even outside the selected window", () => {
    for (const operation of [recentlyPlayed, mostPlayed]) {
      fails(
        () => operation(tracks, [play("same", 0, 0), play("same", 1, 1000)], { from: 2000 }),
        "duplicate-play",
      );
      fails(
        () => operation(tracks, [{ id: "event", trackId: "unknown", playedAt: 0 }], { from: 2000 }),
        "unknown-track",
      );
      fails(() => operation([track("a"), track("a")], []), "duplicate-track");
    }
  });
});
