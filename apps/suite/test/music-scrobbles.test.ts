// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  importScrobbles,
  MAX_EXPORT_BYTES,
  MAX_LISTENS,
  parseLastFm,
  parseListenBrainz,
  ScrobbleError,
  type ScrobbleExports,
  type ScrobbleImportOptions,
} from "../src/apps/music/lib/scrobbles";

const options = { now: new Date("2026-10-26T12:00:00Z") };
const epoch = 1_704_067_200;
const recording = "12345678-1234-1234-1234-123456789abc";
const release = "abcdef12-abcd-abcd-abcd-abcdef123456";
const artistId = "00000000-0000-0000-0000-000000000001";
const header = "artist,album,track,timestamp";
const row = (seconds = epoch, meta: Record<string, unknown> = {}) => ({
  listened_at: seconds,
  track_metadata: { artist_name: "Mira Example", track_name: "Paper Moon", ...meta },
});
const lb = (rows: unknown[]) => parseListenBrainz(JSON.stringify(rows), options);
const csv = (rows: string) => parseLastFm(`${header}\n${rows}`, options);

function fails(run: () => unknown, code: string) {
  expect(run).toThrow(ScrobbleError);
  expect(run).toThrow(expect.objectContaining({ code, message: `Scrobbles: ${code}` }));
}

it("normalizes all ListenBrainz fields and preserves display text and synthetic metadata", () => {
  const result = lb([
    row(epoch, {
      artist_name: "  Mira Example 🎵  ",
      track_name: 'Paper, "Moon" \\ [ ] { }',
      release_name: "Café 楽",
      additional_info: {
        duration_ms: 180_000,
        recording_mbid: recording,
        release_mbid: release,
        artist_mbids: [artistId, recording],
        source: "https://example.org/music",
        nested: [{ text: '\\" ], { }' }],
      },
    }),
  ]);
  expect(result).toEqual({
    listens: [
      {
        playedAt: "2024-01-01T00:00:00.000Z",
        artist: "  Mira Example 🎵  ",
        track: 'Paper, "Moon" \\ [ ] { }',
        album: "Café 楽",
        durationMs: 180_000,
        mbids: { recording, release, artists: [artistId, recording] },
        source: "listenbrainz",
      },
    ],
    warnings: [],
  });
  expect(
    lb([row(epoch, { release_name: "  ", additional_info: { duration_ms: 0, artist_mbids: [] } })])
      .listens[0],
  ).toEqual({
    playedAt: "2024-01-01T00:00:00.000Z",
    artist: "Mira Example",
    track: "Paper Moon",
    durationMs: 0,
    mbids: {},
    source: "listenbrainz",
  });
  expect(lb([row(epoch, { release_name: "", additional_info: {} })]).warnings).toEqual([]);
});

it("accepts arrays and JSON Lines with BOM, blank lines and physical warning line numbers", () => {
  expect(parseListenBrainz("\uFEFF \r\n[ \r\n ] \r\n\t", options)).toEqual({
    listens: [],
    warnings: [],
  });
  const pretty = `[\n${JSON.stringify(row(), null, 2)},\n  null,\n${JSON.stringify(
    row(epoch + 60, {
      additional_info: { recording_mbid: "invalid" },
    }),
    null,
    2,
  )}\n]`;
  const badLine = pretty.slice(0, pretty.indexOf("null")).split("\n").length;
  const mbidLine = pretty
    .slice(0, pretty.indexOf("{\n", pretty.indexOf("null")))
    .split("\n").length;
  expect(parseListenBrainz(pretty, options).warnings).toEqual([
    expect.objectContaining({ code: "INVALID_LISTEN", source: "listenbrainz", line: badLine }),
    expect.objectContaining({ code: "INVALID_MBID", source: "listenbrainz", line: mbidLine }),
  ]);
  const jsonl = `\uFEFF\n\t${JSON.stringify(row())}\r\n \t\r\nnull\r${JSON.stringify(row(epoch + 60))}\n`;
  const parsed = parseListenBrainz(jsonl, options);
  expect(parsed.listens).toHaveLength(2);
  expect(parsed.warnings).toEqual([expect.objectContaining({ line: 4, code: "INVALID_LISTEN" })]);
  expect(parseListenBrainz(JSON.stringify(row()), options).listens).toHaveLength(1);
  expect(parseListenBrainz("{}", options).warnings[0]?.code).toBe("INVALID_LISTEN");
});

it("uses CSV header order and RFC 4180 commas, quotes, empty fields and multiline values", () => {
  const text =
    '\uFEFF"timestamp",track,album,artist,extra\r\n' +
    `${epoch},"Paper, ""Moon""","First\r\nSecond","Mira\nExample",https://example.org/music\r\n` +
    `${epoch + 60},Next,,Rowan Fiction,\r\n` +
    `${epoch + 120},"Last","",Mira Example,ignored`;
  const result = parseLastFm(text, options);
  expect(result.warnings).toEqual([]);
  expect(result.listens).toEqual([
    {
      playedAt: "2024-01-01T00:00:00.000Z",
      artist: "Mira\nExample",
      track: 'Paper, "Moon"',
      album: "First\r\nSecond",
      mbids: {},
      source: "lastfm",
    },
    {
      playedAt: "2024-01-01T00:01:00.000Z",
      artist: "Rowan Fiction",
      track: "Next",
      mbids: {},
      source: "lastfm",
    },
    {
      playedAt: "2024-01-01T00:02:00.000Z",
      artist: "Mira Example",
      track: "Last",
      mbids: {},
      source: "lastfm",
    },
  ]);
  expect(
    csv(`"Mira\rExample",,Moon,${epoch}\n,,,\nshort\n,,\nextra,,,,field`).warnings.map((w) => [
      w.line,
      w.code,
    ]),
  ).toEqual([
    [4, "INVALID_LISTEN"],
    [5, "INVALID_LISTEN"],
    [6, "INVALID_LISTEN"],
    [7, "INVALID_LISTEN"],
  ]);
  expect(csv("\n").warnings).toEqual([expect.objectContaining({ line: 2 })]);
  expect(parseLastFm(header, options)).toEqual({ listens: [], warnings: [] });
  expect(parseLastFm(`${header}\n`, options).listens).toEqual([]);
  expect(
    parseLastFm(`__proto__,${header}\nunused,Mira,,Moon,${epoch}`, options).listens,
  ).toHaveLength(1);
});

it("parses each English month in UTC and rejects rollovers, coercions and missing values", () => {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const rows = months
    .map((month, index) => `Mira,,Track ${index},02 ${month} 2024 03:04`)
    .join("\n");
  expect(csv(rows).listens.map((listen) => listen.playedAt)).toEqual(
    months.map((_, index) => new Date(Date.UTC(2024, index, 2, 3, 4)).toISOString()),
  );
  expect(csv("Mira,,Leap,29 Feb 2024 23:59").listens[0]?.playedAt).toBe("2024-02-29T23:59:00.000Z");
  const bad = [
    "",
    "NaN",
    "Infinity",
    "0x1234",
    "1e9",
    "1704067200.5",
    " 1704067200",
    "1704067200 ",
    "2024-01-01",
    "2 Jan 2024 03:04",
    "02 JAN 2024 03:04",
    "02 Xxx 2024 03:04",
    "00 Jan 2024 03:04",
    "31 Feb 2024 03:04",
    "29 Feb 2023 03:04",
    "02 Jan 0001 03:04",
    "02 Jan 2024 24:00",
    "02 Jan 2024 03:60",
    "02 Jan 2024 03:04 UTC",
  ];
  expect(csv(bad.map((value) => `Mira,,Moon,${value}`).join("\n")).warnings).toHaveLength(
    bad.length,
  );
});

it("accepts both date bounds inclusively and skips dates outside the injected window", () => {
  const earliest = Date.UTC(2002, 0, 1) / 1000;
  const latest = options.now.getTime() / 1000 + 86_400;
  const result = lb([row(earliest - 1), row(earliest), row(latest), row(latest + 1)]);
  expect(result.listens.map((listen) => listen.playedAt)).toEqual([
    "2002-01-01T00:00:00.000Z",
    "2026-10-27T12:00:00.000Z",
  ]);
  expect(result.warnings.map((w) => w.code)).toEqual(["INVALID_LISTEN", "INVALID_LISTEN"]);
  expect(csv("Mira,,Moon,01 Jan 2002 00:00").listens[0]?.playedAt).toBe("2002-01-01T00:00:00.000Z");
  expect(
    parseListenBrainz(JSON.stringify([row(epoch)]), { now: new Date("2001-01-01Z") }).warnings,
  ).toHaveLength(1);
  expect(
    parseListenBrainz(JSON.stringify([row(8_640_000_000_001)]), {
      now: new Date(8_640_000_000_000_000),
    }).warnings,
  ).toEqual([expect.objectContaining({ code: "INVALID_LISTEN" })]);
});

it("skips malformed ListenBrainz rows and required or optional fields with one row warning", () => {
  const bad: unknown[] = [
    null,
    [],
    true,
    0,
    "text",
    {},
    { track_metadata: null },
    { track_metadata: [] },
    { listened_at: epoch, track_metadata: {} },
    { ...row(), listened_at: undefined },
    { ...row(), listened_at: "1704067200" },
    row(-1),
    row(1.5),
    row(1e100),
    ...[undefined, null, 1, "", " \t\n"].map((value) => row(epoch, { artist_name: value })),
    ...[undefined, null, [], "", " \t\n"].map((value) => row(epoch, { track_name: value })),
    ...[null, 123].map((value) => row(epoch, { release_name: value })),
    ...[null, [], "wrong"].map((value) => row(epoch, { additional_info: value })),
    ...[null, "100", -1, 0.5, 1e100].map((value) =>
      row(epoch, { additional_info: { duration_ms: value } }),
    ),
  ];
  const result = lb(bad);
  expect(result.listens).toEqual([]);
  expect(result.warnings).toHaveLength(bad.length);
  expect(result.warnings.every((w) => w.code === "INVALID_LISTEN" && w.line === 1)).toBe(true);
  expect(csv(`,,Moon,${epoch}\nMira,,,${epoch}\nMira,,Moon,`).warnings).toHaveLength(3);
});

it("drops invalid lowercase UUID MBIDs individually and reports their field and line", () => {
  const result = lb([
    row(epoch, {
      additional_info: {
        recording_mbid: recording.toUpperCase(),
        release_mbid: `https://example.org/${release}`,
        artist_mbids: [
          artistId,
          null,
          "wrong",
          recording,
          1,
          " abcdef12-abcd-abcd-abcd-abcdef123456",
        ],
      },
    }),
  ]);
  expect(result.listens[0]?.mbids).toEqual({ artists: [artistId, recording] });
  expect(result.warnings.map((w) => [w.code, w.line, w.field])).toEqual([
    ["INVALID_MBID", 1, "recording_mbid"],
    ["INVALID_MBID", 1, "release_mbid"],
    ["INVALID_MBID", 1, "artist_mbids[1]"],
    ["INVALID_MBID", 1, "artist_mbids[2]"],
    ["INVALID_MBID", 1, "artist_mbids[4]"],
    ["INVALID_MBID", 1, "artist_mbids[5]"],
  ]);
  for (const value of [null, "bad", {}]) {
    const parsed = lb([
      row(epoch, {
        additional_info: { artist_mbids: value, recording_mbid: null, release_mbid: 1 },
      }),
    ]);
    expect(parsed.listens[0]?.mbids).toEqual({});
    expect(parsed.warnings.map((w) => w.field)).toEqual([
      "recording_mbid",
      "release_mbid",
      "artist_mbids",
    ]);
  }
  expect(
    lb([row(epoch, { additional_info: { artist_mbids: ["bad"] } })]).listens[0]?.mbids,
  ).toEqual({});
});

it.each([
  artistId,
  null,
  "bad",
  {},
  42,
  true,
])("warns when dropping non-array artist MBIDs (%j)", (value) => {
  const result = parseListenBrainz(
    `\n${JSON.stringify(row(epoch, { additional_info: { artist_mbids: value } }))}`,
    options,
  );
  expect(result.listens).toEqual(lb([row()]).listens);
  expect(result.warnings).toEqual([
    {
      source: "listenbrainz",
      line: 2,
      code: "INVALID_MBID",
      field: "artist_mbids",
      message: "Invalid MBID dropped.",
    },
  ]);
});

it("deduplicates case and whitespace variants across sources at exactly 30 seconds", () => {
  const result = importScrobbles(
    {
      listenBrainz: JSON.stringify([row(epoch), row(epoch + 100, { track_name: "Other" })]),
      lastFm: `${header}\nMIRAEXAMPLE,,paper\t moon,${epoch + 30}\nMira Example,,Other,${epoch + 131}`,
    },
    options,
  );
  expect(result.listens.map((listen) => [listen.source, listen.playedAt])).toEqual([
    ["listenbrainz", "2024-01-01T00:00:00.000Z"],
    ["listenbrainz", "2024-01-01T00:01:40.000Z"],
    ["lastfm", "2024-01-01T00:02:11.000Z"],
  ]);
  expect(result.warnings).toEqual([]);
});

it("keeps the more complete record, counts optional MBID fields, and gives ties to ListenBrainz", () => {
  const inputs = {
    listenBrainz: JSON.stringify([row()]),
    lastFm: `${header}\nMira Example,Album,Paper Moon,${epoch}`,
  };
  expect(importScrobbles(inputs, options).listens[0]?.source).toBe("lastfm");
  for (const meta of [
    { release_name: "Album" },
    { additional_info: { duration_ms: 0 } },
    { additional_info: { recording_mbid: recording } },
    { additional_info: { release_mbid: release } },
    { additional_info: { artist_mbids: [artistId, recording] } },
  ]) {
    expect(
      importScrobbles({ ...inputs, listenBrainz: JSON.stringify([row(epoch + 1, meta)]) }, options)
        .listens[0]?.source,
    ).toBe("listenbrainz");
    expect(lb([row(), row(epoch + 1, meta)]).listens[0]?.playedAt).toBe("2024-01-01T00:00:01.000Z");
  }
  expect(lb([row(epoch, { artist_name: "MIRA EXAMPLE" }), row()]).listens[0]?.artist).toBe(
    "MIRA EXAMPLE",
  );
  expect(lb([row(epoch + 1), row()]).listens[0]?.playedAt).toBe("2024-01-01T00:00:00.000Z");
  // A discarded bridge must never cause plays 60 seconds apart to be merged transitively.
  expect(lb([row(), row(epoch + 30), row(epoch + 60)]).listens).toHaveLength(2);
  expect(
    lb([row(), row(epoch + 30, { release_name: "Rich" }), row(epoch + 60)]).listens,
  ).toHaveLength(1);
});

it("checks both neighboring time buckets and preserves listens more than 30 seconds apart", () => {
  const base = epoch + (31 - (epoch % 31));
  const result = lb([
    row(base + 31, { release_name: "Winner" }),
    row(base + 1),
    row(base + 61),
    row(base),
    row(base + 62),
    row(base + 62, { artist_name: "Different" }),
  ]);
  expect(
    result.listens.map((listen) => [listen.artist, Date.parse(listen.playedAt) / 1000 - base]),
  ).toEqual([
    ["Mira Example", 0],
    ["Mira Example", 31],
    ["Different", 62],
    ["Mira Example", 62],
  ]);
});

it("agrees with a quadratic duplicate oracle for arbitrary windows and completeness", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          offset: fc.integer({ min: 0, max: 180 }),
          artist: fc.constantFrom("Mira Example", "MIRAEXAMPLE", "Rowan Fiction"),
          track: fc.constantFrom("Paper Moon", "paper\tmoon", "Night"),
          album: fc.boolean(),
          duration: fc.boolean(),
        }),
        { maxLength: 60 },
      ),
      (values) => {
        const candidates = values.map((value, index) => ({ ...value, index }));
        candidates.sort(
          (a, b) =>
            Number(b.album) + Number(b.duration) - Number(a.album) - Number(a.duration) ||
            a.offset - b.offset ||
            a.index - b.index,
        );
        const kept: typeof candidates = [];
        const key = (text: string) => text.toLowerCase().replace(/\s/g, "");
        for (const candidate of candidates) {
          if (
            !kept.some(
              (other) =>
                key(other.artist) === key(candidate.artist) &&
                key(other.track) === key(candidate.track) &&
                Math.abs(other.offset - candidate.offset) <= 30,
            )
          ) {
            kept.push(candidate);
          }
        }
        const actual = lb(
          values.map((value) =>
            row(epoch + value.offset, {
              artist_name: value.artist,
              track_name: value.track,
              ...(value.album ? { release_name: "Album" } : {}),
              ...(value.duration ? { additional_info: { duration_ms: 0 } } : {}),
            }),
          ),
        ).listens;
        expect(actual).toHaveLength(kept.length);
        for (const listen of actual) {
          expect(
            kept.some(
              (value) =>
                value.artist === listen.artist &&
                value.track === listen.track &&
                new Date((epoch + value.offset) * 1000).toISOString() === listen.playedAt &&
                value.album === (listen.album !== undefined) &&
                value.duration === (listen.durationMs !== undefined),
            ),
          ).toBe(true);
        }
      },
    ),
    { seed: 261026, numRuns: 200 },
  );
});

it("sorts by time, artist and track deterministically and avoids composite-key collisions", () => {
  const rows = [
    row(epoch + 60, { artist_name: "Zed" }),
    row(epoch, { artist_name: "Zed" }),
    row(epoch, { artist_name: "Ada", track_name: "Zebra" }),
    row(epoch, { artist_name: "Ada", track_name: "Alpha" }),
    row(epoch, { artist_name: "a|b", track_name: "c" }),
    row(epoch, { artist_name: "a", track_name: "b|c" }),
  ];
  const result = lb(rows);
  expect(result.listens.map((listen) => [listen.artist, listen.track])).toEqual([
    ["Ada", "Alpha"],
    ["Ada", "Zebra"],
    ["Zed", "Paper Moon"],
    ["a", "b|c"],
    ["a|b", "c"],
    ["Zed", "Paper Moon"],
  ]);
});

describe("typed file failures", () => {
  it("rejects malformed JSON, unsupported wrappers and incomplete arrays without falling back", () => {
    for (const text of [
      "",
      " \r\n\t",
      "not JSON",
      "[",
      "[}",
      "[,]",
      "[null,]",
      "[null,,null]",
      "[null]tail",
      "[tru]",
      '["unterminated]',
      '[{"a":1]',
      "[{]}]",
      `${JSON.stringify(row())}\nnot-json`,
      JSON.stringify(row(), null, 2),
      "\uFEFF\uFEFF[]",
    ]) {
      fails(() => parseListenBrainz(text, options), "INVALID_EXPORT");
    }
  });
  it("rejects malformed quoting, missing or ambiguous headers, and other delimiters", () => {
    for (const text of [
      "",
      "\uFEFF",
      "artist,track,timestamp",
      "artist,album,track",
      "artist,album,timestamp",
      "album,track,timestamp",
      "Artist,album,track,timestamp",
      "artist;album;track;timestamp",
      `${header},artist`,
      `${header},`,
      `${header}\n"open`,
      `${header}\nwrong"quote,,,`,
      `${header}\n"closed"extra,,,`,
      `${header}\rMira,,Moon,${epoch}`,
      JSON.stringify(row()),
      `${epoch},Moon,Album,Mira`,
    ]) {
      fails(() => parseLastFm(text, options), "INVALID_EXPORT");
    }
  });
  it("requires string exports, supported input keys, well-formed Unicode, and a valid injected clock", () => {
    expect(importScrobbles({}, options)).toEqual({ listens: [], warnings: [] });
    for (const input of [
      null,
      [],
      { unsupported: "file" },
      { listenBrainz: 1 },
      { lastFm: null },
    ]) {
      fails(() => importScrobbles(input as ScrobbleExports, options), "INVALID_EXPORT");
    }
    for (const config of [undefined, {}, { now: "2024-01-01" }, { now: new Date(NaN) }]) {
      fails(() => importScrobbles({}, config as ScrobbleImportOptions), "INVALID_EXPORT");
    }
    for (const text of ["\ud800", "\ud800x", "\udc00"]) {
      fails(() => parseListenBrainz(text, options), "INVALID_EXPORT");
    }
    for (const text of [undefined, null, 1, {}]) {
      fails(() => parseListenBrainz(text as string, options), "INVALID_EXPORT");
      fails(() => parseLastFm(text as string, options), "INVALID_EXPORT");
    }
    expect(new ScrobbleError("INVALID_EXPORT").name).toBe("ScrobbleError");
  });
});

describe("real exported size boundaries", () => {
  it("accepts exactly 64 MiB and rejects one extra ASCII byte before parsing", () => {
    expect(MAX_EXPORT_BYTES).toBe(67_108_864);
    const exact = `[${" ".repeat(MAX_EXPORT_BYTES - 2)}]`;
    expect(parseListenBrainz(exact, options)).toEqual({ listens: [], warnings: [] });
    const parse = vi.spyOn(JSON, "parse");
    try {
      fails(() => parseListenBrainz(`${exact} `, options), "EXPORT_TOO_LARGE");
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  }, 120_000);

  it("measures UTF-8 bytes rather than UTF-16 units, including the exact multibyte boundary", () => {
    const exact = `["${"é".repeat((MAX_EXPORT_BYTES - 4) / 2)}"]`;
    expect(parseListenBrainz(exact, options).warnings).toHaveLength(1);
    fails(() => parseListenBrainz(`${exact} `, options), "EXPORT_TOO_LARGE");
    fails(
      () => importScrobbles({ listenBrainz: exact, lastFm: header }, options),
      "EXPORT_TOO_LARGE",
    );
  }, 120_000);

  it("accepts exactly one million JSON rows, including invalid rows, before deduplication", () => {
    expect(MAX_LISTENS).toBe(1_000_000);
    const exact = `[${"0,".repeat(MAX_LISTENS - 1)}0]`;
    expect(parseListenBrainz(exact, options).warnings).toHaveLength(MAX_LISTENS);
    const parse = vi.spyOn(JSON, "parse");
    try {
      fails(() => parseListenBrainz(`[${"0,".repeat(MAX_LISTENS)}0]`, options), "EXPORT_TOO_LARGE");
      fails(
        () => importScrobbles({ listenBrainz: exact, lastFm: `${header}\n,,,` }, options),
        "EXPORT_TOO_LARGE",
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  }, 120_000);

  it("excludes the CSV header, accepts one million rows and rejects bound+1", () => {
    const exact = `${header}\n${"\n".repeat(MAX_LISTENS)}`;
    expect(parseLastFm(exact, options).warnings).toHaveLength(MAX_LISTENS);
    fails(() => parseLastFm(`${exact}\n`, options), "EXPORT_TOO_LARGE");
    fails(() => parseListenBrainz("0\n".repeat(MAX_LISTENS + 1), options), "EXPORT_TOO_LARGE");
  }, 120_000);
});
