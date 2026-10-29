// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  evaluateSmartPlaylist,
  parseSmartPlaylist,
  type SmartPlaylist,
  SmartPlaylistError,
  type SmartPlaylistRule,
  type SmartPlaylistSort,
  type SmartPlaylistTrack,
  serializeSmartPlaylist,
  validateSmartPlaylist,
} from "../src/apps/music/lib/smart";

const track = (id: string, values: Partial<SmartPlaylistTrack> = {}): SmartPlaylistTrack => ({
  id: `https://example.org/music/${id}`,
  title: "Paper Moon",
  artist: "Mira Vale",
  albumId: "https://example.org/albums/lanterns",
  albumTitle: "Lanterns",
  genre: "Folk",
  year: 2024,
  playCount: 10,
  lastPlayedAt: Date.UTC(2026, 9, 25),
  rating: 4.5,
  ...values,
});
const a = track("a");
const b = track("b", {
  title: "Quiet Rivers",
  artist: "Tavi Reed",
  albumTitle: "Open Water",
  genre: "Jazz",
  year: 2020,
  playCount: 0,
  lastPlayedAt: 0,
  rating: 2,
});
const c = track("c", { title: "Rising Light", genre: "Folk", year: 2025, rating: 5 });
const library = [a, b, c];
const definition = (
  rules: readonly SmartPlaylistRule[] = [],
  options: Partial<SmartPlaylist> = {},
): SmartPlaylist => ({
  version: 1,
  mode: "all",
  rules,
  ...options,
});
const invalid = (value: unknown) => value as SmartPlaylist;

function fails(action: () => unknown, code: SmartPlaylistError["code"]) {
  expect(action).toThrow(SmartPlaylistError);
  expect(action).toThrow(expect.objectContaining({ code, name: "SmartPlaylistError" }));
}

describe("smart playlist evaluation", () => {
  it.each<[SmartPlaylistRule, readonly SmartPlaylistTrack[]]>([
    [{ field: "artist", operator: "eq", value: "Mira Vale" }, [a, c]],
    [{ field: "album", operator: "ne", value: "Lanterns" }, [b]],
    [{ field: "genre", operator: "contains", value: "olk" }, [a, c]],
    [{ field: "artist", operator: "startsWith", value: "Mira" }, [a, c]],
    [{ field: "album", operator: "endsWith", value: "Water" }, [b]],
    [{ field: "year", operator: "lt", value: 2024 }, [b]],
    [{ field: "year", operator: "lte", value: 2024 }, [a, b]],
    [{ field: "playCount", operator: "gt", value: 0 }, [a, c]],
    [{ field: "rating", operator: "gte", value: 4.5 }, [a, c]],
    [{ field: "lastPlayedAt", operator: "eq", value: 0 }, [b]],
    [{ field: "rating", operator: "ne", value: 2 }, [a, c]],
    [{ field: "artist", operator: "eq", value: "mira vale" }, []],
    [{ field: "album", operator: "eq", value: a.albumId }, []],
  ])("matches %j", (rule, expected) => {
    expect(evaluateSmartPlaylist(library, definition([rule]))).toEqual(expected);
  });

  it("compares each numeric field at equal, lower and upper thresholds", () => {
    for (const field of ["year", "playCount", "lastPlayedAt", "rating"] as const) {
      for (const [operator, expected] of [
        ["eq", [false, true, false]],
        ["ne", [true, false, true]],
        ["lt", [false, false, true]],
        ["lte", [false, true, true]],
        ["gt", [true, false, false]],
        ["gte", [true, true, false]],
      ] as const) {
        for (const [index, delta] of [-1, 0, 1].entries()) {
          const rule: SmartPlaylistRule = {
            field,
            operator,
            value: (a[field] as number) + delta * (field === "rating" ? 0.25 : 1),
          };
          const playlist = parseSmartPlaylist(serializeSmartPlaylist(definition([rule])));
          expect(evaluateSmartPlaylist([a], playlist)).toEqual(expected[index] ? [a] : []);
        }
      }
    }
  });

  it("matches each text operator literally for every text field", () => {
    for (const field of ["artist", "album", "genre"] as const) {
      const value = field === "album" ? a.albumTitle : (a[field] as string);
      for (const [operator, query, match] of [
        ["eq", value, true],
        ["eq", value.toUpperCase(), false],
        ["ne", value, false],
        ["ne", value.toUpperCase(), true],
        ["contains", value.slice(1, -1), true],
        ["contains", "[a-z]", false],
        ["startsWith", value.slice(0, 2), true],
        ["startsWith", value.slice(1), false],
        ["endsWith", value.slice(-2), true],
        ["endsWith", value.slice(0, -1), false],
      ] as const) {
        const playlist = parseSmartPlaylist(
          serializeSmartPlaylist(definition([{ field, operator, value: query }])),
        );
        expect(evaluateSmartPlaylist([a], playlist)).toEqual(match ? [a] : []);
      }
    }
  });

  it("combines all/any rules and defines empty groups", () => {
    const rules: SmartPlaylistRule[] = [
      { field: "artist", operator: "eq", value: "Mira Vale" },
      { field: "year", operator: "gte", value: 2025 },
    ];
    expect(evaluateSmartPlaylist(library, definition(rules))).toEqual([c]);
    expect(evaluateSmartPlaylist(library, definition(rules, { mode: "any" }))).toEqual([a, c]);
    expect(evaluateSmartPlaylist(library, definition())).toEqual(library);
    expect(evaluateSmartPlaylist(library, definition([], { mode: "any" }))).toEqual([]);
    expect(evaluateSmartPlaylist([], definition(rules))).toEqual([]);
  });

  it("treats missing metadata as unknown, including negative comparisons", () => {
    const unknown: SmartPlaylistTrack = {
      id: "https://example.org/music/unknown",
      title: "Unknown Horizons",
      artist: "Mira Vale",
      albumId: a.albumId,
      albumTitle: a.albumTitle,
    };
    for (const rule of [
      { field: "genre", operator: "ne", value: "Jazz" },
      { field: "year", operator: "eq", value: 2024 },
      { field: "playCount", operator: "eq", value: 0 },
      { field: "lastPlayedAt", operator: "lt", value: 0 },
      { field: "rating", operator: "ne", value: 0 },
    ] as const)
      expect(evaluateSmartPlaylist([unknown], definition([rule]))).toEqual([]);
  });

  it("re-evaluates metadata changes, additions and removals without state or mutation", () => {
    const playlist = Object.freeze(
      definition([{ field: "playCount", operator: "gte", value: 10 }]),
    );
    const original = Object.freeze([Object.freeze(a), Object.freeze(b)]);
    const result = evaluateSmartPlaylist(original, playlist);
    expect(result).toEqual([a]);
    expect(result[0]).toBe(a);
    result.pop();
    expect(evaluateSmartPlaylist(original, playlist)).toEqual([a]);
    const updated = { ...b, playCount: 11, extraMetadata: "preserved" };
    const changed = evaluateSmartPlaylist([updated, c], playlist);
    expect(changed).toEqual([updated, c]);
    expect(evaluateSmartPlaylist([updated], playlist)[0]?.extraMetadata).toBe("preserved");
    expect(original).toEqual([a, b]);
  });

  it.each<SmartPlaylistSort["field"]>([
    "title",
    "artist",
    "album",
    "genre",
    "year",
    "playCount",
    "lastPlayedAt",
    "rating",
  ])("sorts %s in either direction before limiting", (field) => {
    const ascending =
      field === "year" || field === "playCount" || field === "lastPlayedAt" || field === "rating"
        ? [b, a]
        : [a, b];
    expect(
      evaluateSmartPlaylist([b, a], definition([], { sort: { field, direction: "asc" } })),
    ).toEqual(ascending);
    expect(
      evaluateSmartPlaylist(
        [b, a],
        definition([], { sort: { field, direction: "desc" }, limit: 1 }),
      ),
    ).toEqual([ascending[1]]);
  });

  it("breaks sort ties by exact ID and keeps missing values last in both directions", () => {
    const missingA = track("missing-a", {
      rating: undefined,
    } as unknown as Partial<SmartPlaylistTrack>);
    const missingB = track("missing-b", {
      rating: undefined,
    } as unknown as Partial<SmartPlaylistTrack>);
    const input = [missingB, c, a, missingA, b];
    expect(
      evaluateSmartPlaylist(input, definition([], { sort: { field: "rating", direction: "asc" } })),
    ).toEqual([b, a, c, missingA, missingB]);
    expect(
      evaluateSmartPlaylist(
        input,
        definition([], { sort: { field: "rating", direction: "desc" } }),
      ),
    ).toEqual([c, a, b, missingA, missingB]);
    expect(
      evaluateSmartPlaylist(
        [c, a],
        definition([], { sort: { field: "artist", direction: "desc" } }),
      ),
    ).toEqual([a, c]);
    expect(input).toEqual([missingB, c, a, missingA, b]);
  });

  it("preserves library order without sort and supports zero/oversized limits", () => {
    expect(evaluateSmartPlaylist([c, a, b], definition([], { limit: 2 }))).toEqual([c, a]);
    expect(evaluateSmartPlaylist(library, definition([], { limit: 0 }))).toEqual([]);
    expect(
      evaluateSmartPlaylist(library, definition([], { limit: Number.MAX_SAFE_INTEGER })),
    ).toEqual(library);
  });
});

describe("playlist JSON schema", () => {
  it("round-trips a complete definition and returns independent data records", () => {
    const playlist = definition(
      [
        { field: "artist", operator: "contains", value: "Mira" },
        { field: "lastPlayedAt", operator: "gte", value: 0 },
      ],
      { mode: "any", sort: { field: "rating", direction: "desc" }, limit: 5 },
    );
    const restored = parseSmartPlaylist(serializeSmartPlaylist(playlist));
    expect(restored).toEqual(playlist);
    expect(restored).not.toBe(playlist);
    expect(restored.rules).not.toBe(playlist.rules);
    expect(restored.rules[0]).not.toBe(playlist.rules[0]);
    expect(restored.sort).not.toBe(playlist.sort);
    expect(evaluateSmartPlaylist(library, restored)).toEqual(
      evaluateSmartPlaylist(library, playlist),
    );
    expect(parseSmartPlaylist(serializeSmartPlaylist(definition()))).toEqual(definition());
    expect(validateSmartPlaylist(Object.assign(Object.create(null), definition()))).toEqual(
      definition(),
    );
  });

  it.each([
    "",
    "{",
    "undefined",
    "NaN",
    '{"rules":[]',
    null,
    5,
    {},
  ])("rejects malformed JSON %j", (json) => {
    fails(() => parseSmartPlaylist(json as string), "invalid-json");
  });

  it.each([
    null,
    [],
    "playlist",
    new Date(),
    Object.create({ version: 1 }),
    {},
    { version: 2, mode: "all", rules: [] },
    { version: 1, mode: "none", rules: [] },
    { version: 1, mode: "all" },
    { version: 1, mode: "all", rules: {} },
    definition([], { extra: true } as Partial<SmartPlaylist>),
    definition([], { sort: undefined } as unknown as Partial<SmartPlaylist>),
    definition([], { limit: undefined } as unknown as Partial<SmartPlaylist>),
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null].map((limit) => ({
      ...definition(),
      limit,
    })),
    ...[
      null,
      {},
      [],
      { field: "unknown", direction: "asc" },
      { field: "year", direction: "up" },
      { field: "year", direction: "asc", extra: true },
    ].map((sort) => ({ ...definition(), sort })),
  ])("rejects unsupported definition %j", (value) => {
    fails(() => validateSmartPlaylist(value), "invalid-playlist");
    fails(() => serializeSmartPlaylist(invalid(value)), "invalid-playlist");
    // Only JSON-compatible cases go through JSON.parse here.
  });

  it.each([
    null,
    [],
    {},
    { field: "artist" },
    { field: "artist", operator: 1, value: "Mira Vale" },
    { field: "title", operator: "eq", value: "Paper Moon" },
    { field: "artist", operator: "lt", value: "Mira Vale" },
    { field: "artist", operator: "eq", value: 2 },
    { field: "year", operator: "contains", value: 2024 },
    { field: "year", operator: "eq", value: "2024" },
    { field: "genre", operator: "regex", value: ".*" },
    { field: "year", operator: "eq", value: 2024, enabled: true },
    ...["", " space", "space ", "bad\ntext", "\ud800", null].map((value) => ({
      field: "artist",
      operator: "eq",
      value,
    })),
    ...[0, -1, 10000, 2024.5, NaN, Infinity, null].map((value) => ({
      field: "year",
      operator: "eq",
      value,
    })),
    ...[-1, 2.5, Number.MAX_SAFE_INTEGER + 1].map((value) => ({
      field: "playCount",
      operator: "eq",
      value,
    })),
    ...[-0.1, 5.1].map((value) => ({ field: "rating", operator: "eq", value })),
    ...["2026-10-25", 0.5, 8_640_000_000_000_001, -8_640_000_000_000_001].map((value) => ({
      field: "lastPlayedAt",
      operator: "eq",
      value,
    })),
    { mode: "all", rules: [] },
  ])("rejects unsupported rule %j even for an empty library", (rule) => {
    const value = { ...definition(), rules: [rule] };
    fails(() => evaluateSmartPlaylist([], invalid(value)), "invalid-playlist");
    fails(() => parseSmartPlaylist(JSON.stringify(value)), "invalid-playlist");
  });

  it("rejects holes, symbols, accessors and hidden keys without invoking them", () => {
    fails(() => validateSmartPlaylist({ ...definition(), rules: Array(1) }), "invalid-playlist");
    fails(
      () => validateSmartPlaylist({ ...definition(), [Symbol("unknown")]: true }),
      "invalid-playlist",
    );
    const getter = Object.defineProperty({}, "version", {
      enumerable: true,
      get: () => {
        throw Error("invoked");
      },
    });
    fails(() => validateSmartPlaylist(getter), "invalid-playlist");
    fails(
      () => validateSmartPlaylist(Object.defineProperty(definition(), "hidden", { value: true })),
      "invalid-playlist",
    );
    fails(
      () =>
        serializeSmartPlaylist({ ...definition(), toJSON: () => definition() } as SmartPlaylist),
      "invalid-playlist",
    );
  });
});

describe("library validation", () => {
  it.each([
    null,
    {},
    [null],
    [a, a],
    Array(1),
    [new Date()],
    [track("a", { title: "" })],
    [track("a", { artist: "bad\nname" })],
    [track("a", { genre: "" })],
    [track("a", { genre: ["Folk"] } as unknown as Partial<SmartPlaylistTrack>)],
    [track("a", { year: 0 })],
    [track("a", { year: 9999.5 })],
    [track("a", { playCount: -1 })],
    [track("a", { playCount: Number.MAX_SAFE_INTEGER + 1 })],
    [track("a", { lastPlayedAt: NaN })],
    [track("a", { lastPlayedAt: 8_640_000_000_000_001 })],
    [track("a", { rating: 6 })],
    [track("a", { rating: null } as unknown as Partial<SmartPlaylistTrack>)],
    [Object.assign(Object.create({ rating: 5 }), a)],
  ])("rejects invalid library %j even when no tracks can be selected", (value) => {
    fails(
      () =>
        evaluateSmartPlaylist(
          value as readonly SmartPlaylistTrack[],
          definition([], { mode: "any", limit: 0 }),
        ),
      "invalid-library",
    );
  });

  it("rejects array overrides and accessors without running caller code", () => {
    const trap = () => {
      throw new Error("must not run");
    };
    const extra = Object.assign([a], { filter: trap });
    const accessor = Object.defineProperty([a], 0, { get: trap });
    const hidden = Object.defineProperty([a], 0, { value: a, enumerable: false });
    const custom = Object.setPrototypeOf([a], Object.create(Array.prototype));
    const holeAndExtra = Object.assign(Array(1), { extra: a });
    for (const value of [extra, accessor, hidden, custom, holeAndExtra]) {
      fails(() => evaluateSmartPlaylist(value, definition()), "invalid-library");
    }
    const rule = { field: "year", operator: "eq", value: 2024 };
    for (const rules of [
      Object.assign([rule], { [Symbol.iterator]: trap }),
      Object.defineProperty([rule], 0, { get: trap }),
      Object.assign([rule], { extra: true }),
    ]) {
      fails(() => validateSmartPlaylist({ ...definition(), rules }), "invalid-playlist");
    }
  });

  it("validates filtered-out records and does not echo caller data into errors", () => {
    fails(
      () =>
        evaluateSmartPlaylist(
          [a, track("bad", { rating: -1 })],
          definition([{ field: "artist", operator: "eq", value: "Nobody" }]),
        ),
      "invalid-library",
    );
    expect(new SmartPlaylistError("invalid-library").message).toBe(
      "Smart playlist: invalid-library",
    );
  });

  it.each([
    { year: 1, playCount: 0, lastPlayedAt: -8_640_000_000_000_000, rating: 0 },
    {
      year: 9999,
      playCount: Number.MAX_SAFE_INTEGER,
      lastPlayedAt: 8_640_000_000_000_000,
      rating: 5,
    },
  ])("accepts numeric boundaries %j", (metadata) => {
    const item = track("boundaries", metadata);
    expect(evaluateSmartPlaylist([item], definition())).toEqual([item]);
    for (const field of ["year", "playCount", "lastPlayedAt", "rating"] as const) {
      expect(
        evaluateSmartPlaylist(
          [item],
          definition([{ field, operator: "eq", value: metadata[field] }]),
        ),
      ).toEqual([item]);
    }
  });
});
