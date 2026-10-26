// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  buildTimelineSections,
  groupPhotos,
  onThisDay,
  PhotoTimelineError,
  type PhotoTimelineErrorCode,
  type TimelineOptions,
  type TimelinePhoto,
} from "../src/apps/photos/lib/timeline";

const options = { unit: "day", timeZone: "UTC" } as const;
const photo = (id: string, capturedAt: number | string, captureOffset?: string): TimelinePhoto => ({
  id: `https://example.org/photos/${id}`,
  capturedAt,
  ...(captureOffset === undefined ? {} : { captureOffset }),
});
const epoch = (value: string) => Date.parse(value);
const keys = (photos: readonly TimelinePhoto[], opts: TimelineOptions = options) =>
  groupPhotos(photos, opts).map(({ key }) => key);
const ids = (photos: readonly TimelinePhoto[]) => photos.map(({ id }) => id.split("/").at(-1));
function fails(run: () => unknown, code: PhotoTimelineErrorCode) {
  expect(run).toThrow(PhotoTimelineError);
  expect(run).toThrow(expect.objectContaining({ name: "PhotoTimelineError", code }));
}

describe("capture-calendar grouping", () => {
  const photos = Object.freeze([
    Object.freeze(photo("old", "2023-12-31T23:59:59Z")),
    Object.freeze(photo("b", "2024-02-29T12:00:00Z")),
    Object.freeze(photo("next", epoch("2025-01-01T00:00:00Z"))),
    Object.freeze(photo("a", "2024-02-29T12:00:00+00:00")),
    Object.freeze(photo("early", "2024-02-29T08:00:00Z")),
    Object.freeze(photo("march", "2024-03-01T00:00:00Z")),
  ]);

  it.each([
    ["day", ["2025-01-01", "2024-03-01", "2024-02-29", "2023-12-31"]],
    ["month", ["2025-01", "2024-03", "2024-02", "2023-12"]],
    ["year", ["2025", "2024", "2023"]],
  ] as const)("groups by %s, newest first, without changing inputs", (unit, expected) => {
    const grouped = groupPhotos(photos, { ...options, unit });
    expect(grouped.map(({ key }) => key)).toEqual(expected);
    expect(ids(grouped.flatMap(({ photos }) => photos))).toEqual([
      "next",
      "march",
      "a",
      "b",
      "early",
      "old",
    ]);
    expect(grouped).toEqual(groupPhotos([...photos].reverse(), { ...options, unit }));
    expect(photos[0]?.id).toContain("old");
  });

  it("sorts ascending and breaks tied instants by ascending UTF-16 id in both directions", () => {
    const grouped = groupPhotos(photos, { ...options, order: "ascending" });
    expect(grouped.map(({ key }) => key)).toEqual([
      "2023-12-31",
      "2024-02-29",
      "2024-03-01",
      "2025-01-01",
    ]);
    expect(ids(grouped[1]?.photos ?? [])).toEqual(["early", "a", "b"]);
    const ties = [photo("z", 0), photo("A", 0), photo("a", 0)];
    expect(ids(groupPhotos(ties, options)[0]?.photos ?? [])).toEqual(["A", "a", "z"]);
    grouped[0]?.photos.pop();
    expect(groupPhotos(photos, options).at(-1)?.photos).toEqual([photos[0]]);
  });

  it("prefers a capture offset over the supplied zone, preserving midnight and year edges", () => {
    expect(
      keys([photo("plus", "2025-01-01T00:15:00+14:00")], {
        ...options,
        timeZone: "America/Los_Angeles",
      }),
    ).toEqual(["2025-01-01"]);
    expect(
      keys([photo("minus", "2024-12-31T23:45:00-12:00")], {
        ...options,
        timeZone: "Pacific/Kiritimati",
      }),
    ).toEqual(["2024-12-31"]);
    expect(
      keys([photo("utc", "2025-01-01T00:15:00Z")], {
        ...options,
        timeZone: "America/Los_Angeles",
      }),
    ).toEqual(["2025-01-01"]);
    expect(keys([photo("numeric", epoch("2024-02-29T18:15:00Z"), "+05:45")])).toEqual([
      "2024-03-01",
    ]);
    expect(keys([photo("numeric", epoch("2025-01-01T01:00:00Z"), "-03:30")])).toEqual([
      "2024-12-31",
    ]);
    expect(keys([photo("agree", "2024-02-29T00:00:00Z", "+00:00")])).toEqual(["2024-02-29"]);
  });

  it("uses only the supplied zone for instants without capture offsets", () => {
    const photos = [photo("zone", epoch("2025-01-01T00:15:00Z"))];
    expect(keys(photos, { ...options, timeZone: "America/Los_Angeles" })).toEqual(["2024-12-31"]);
    expect(keys(photos, { ...options, timeZone: "Asia/Kathmandu" })).toEqual(["2025-01-01"]);
    expect(
      keys([photo("zone", epoch("2024-02-29T18:15:00Z"))], {
        ...options,
        timeZone: "Asia/Kathmandu",
      }),
    ).toEqual(["2024-03-01"]);
  });

  it("orders calendar sections before instants when capture offsets cross", () => {
    const photos = [
      photo("later-instant", "2024-12-31T23:00:00-12:00"),
      photo("earlier-instant", "2025-01-01T01:00:00+14:00"),
    ];
    expect(keys(photos)).toEqual(["2025-01-01", "2024-12-31"]);
    expect(keys(photos, { ...options, order: "ascending" })).toEqual(["2024-12-31", "2025-01-01"]);
  });

  it.each([
    ["spring", ["2024-03-10T06:59:59Z", "2024-03-10T07:00:00Z"], "2024-03-10"],
    ["fall", ["2024-11-03T05:30:00Z", "2024-11-03T06:30:00Z"], "2024-11-03"],
  ] as const)("handles %s DST boundaries as instants", (_name, dates, key) => {
    const photos = dates.map((date, i) => photo(String(i), epoch(date)));
    expect(keys(photos, { ...options, timeZone: "America/New_York" })).toEqual([key]);
  });

  it("distinguishes dates across a 23-hour day and a skipped civil day", () => {
    const dates = ["2024-03-10T04:59:59Z", "2024-03-10T05:00:00Z", "2024-03-11T04:00:00Z"];
    expect(
      keys(
        dates.map((date, i) => photo(String(i), epoch(date))),
        {
          ...options,
          timeZone: "America/New_York",
        },
      ),
    ).toEqual(["2024-03-11", "2024-03-10", "2024-03-09"]);
    expect(
      keys(
        [
          photo("before", epoch("2011-12-30T09:59:59Z")),
          photo("after", epoch("2011-12-30T10:00:00Z")),
        ],
        { ...options, timeZone: "Pacific/Apia" },
      ),
    ).toEqual(["2011-12-31", "2011-12-29"]);
  });

  it("accepts Gregorian boundary years and millisecond precision without rounding", () => {
    const photos = [
      photo("first", "0001-01-01T00:00:00Z"),
      photo("last", "9999-12-31T23:59:59.999Z"),
      photo("ms", "2000-02-29T00:00:00.001Z"),
      photo("tenth", "2000-02-29T00:00:00.1Z"),
      photo("hundredth", "2000-02-29T00:00:00.01Z"),
    ];
    expect(keys(photos)).toEqual(["9999-12-31", "2000-02-29", "0001-01-01"]);
    expect(ids(groupPhotos(photos, options)[1]?.photos ?? [])).toEqual([
      "tenth",
      "hundredth",
      "ms",
    ]);
    expect(keys([photo("first", epoch("0001-01-01T00:00:00Z"))])).toEqual(["0001-01-01"]);
  });

  it("handles empty inputs", () => expect(groupPhotos([], options)).toEqual([]));
});

describe("virtual grid sections", () => {
  const photos = [
    photo("a", 0),
    photo("b", 0),
    photo("c", 0),
    photo("d", "1969-12-31T23:59:00Z"),
    photo("e", "1969-12-31T23:58:00Z"),
  ];
  it("models header indices, partial rows, global photo indices, and section ranges", () => {
    const model = buildTimelineSections(photos, { ...options, columns: 2 });
    expect(model.photoCount).toBe(5);
    expect(model.stickyHeaderIndices).toEqual([0, 3]);
    expect(model.sections).toEqual([
      {
        key: "1970-01-01",
        photos: photos.slice(0, 3),
        startPhotoIndex: 0,
        headerIndex: 0,
        endIndexExclusive: 3,
      },
      {
        key: "1969-12-31",
        photos: photos.slice(3),
        startPhotoIndex: 3,
        headerIndex: 3,
        endIndexExclusive: 5,
      },
    ]);
    expect(model.rows).toEqual([
      { kind: "header", key: "header:1970-01-01", sectionKey: "1970-01-01" },
      {
        kind: "photos",
        key: `photos:1970-01-01:${photos[0]?.id}`,
        sectionKey: "1970-01-01",
        photos: photos.slice(0, 2),
        startPhotoIndex: 0,
      },
      {
        kind: "photos",
        key: `photos:1970-01-01:${photos[2]?.id}`,
        sectionKey: "1970-01-01",
        photos: photos.slice(2, 3),
        startPhotoIndex: 2,
      },
      { kind: "header", key: "header:1969-12-31", sectionKey: "1969-12-31" },
      {
        kind: "photos",
        key: `photos:1969-12-31:${photos[3]?.id}`,
        sectionKey: "1969-12-31",
        photos: photos.slice(3),
        startPhotoIndex: 3,
      },
    ]);
    expect(new Set(model.rows.map(({ key }) => key)).size).toBe(model.rows.length);
    expect(buildTimelineSections([...photos].reverse(), { ...options, columns: 2 })).toEqual(model);
    const row = model.rows[1];
    if (row?.kind === "photos") row.photos.pop();
    expect(model.sections[0]?.photos).toHaveLength(3);
    expect(photos).toHaveLength(5);
  });

  it("supports one-column rows, wide rows, month/year groups, and ascending order", () => {
    expect(buildTimelineSections(photos, { ...options, columns: 1 }).rows).toHaveLength(7);
    const model = buildTimelineSections(photos, {
      ...options,
      columns: 100,
      unit: "year",
      order: "ascending",
    });
    expect(model.sections.map(({ key }) => key)).toEqual(["1969", "1970"]);
    expect(model.stickyHeaderIndices).toEqual([0, 2]);
    expect(
      buildTimelineSections(photos, { ...options, columns: 2, unit: "month" }).sections.map(
        ({ key }) => key,
      ),
    ).toEqual(["1970-01", "1969-12"]);
  });

  it("has no phantom headers or rows for empty input", () => {
    expect(buildTimelineSections([], { ...options, columns: 2 })).toEqual({
      sections: [],
      rows: [],
      stickyHeaderIndices: [],
      photoCount: 0,
    });
  });
});

describe("on this day", () => {
  const photos = [
    photo("old", "2020-06-15T12:00:00Z"),
    photo("b", "2024-06-15T10:00:00Z"),
    photo("a", "2024-06-15T10:00:00Z"),
    photo("early", "2024-06-15T09:00:00Z"),
    photo("other", "2024-06-16T10:00:00Z"),
    photo("same", "2025-06-15T10:00:00Z"),
    photo("future", "2026-06-15T10:00:00Z"),
  ];
  it("selects exact calendar month/day in previous years, grouped newest year first", () => {
    const memories = onThisDay(photos, "2025-06-15", { timeZone: "UTC" });
    expect(memories.map(({ key }) => key)).toEqual(["2024", "2020"]);
    expect(ids(memories[0]?.photos ?? [])).toEqual(["a", "b", "early"]);
    expect(memories).toEqual(onThisDay([...photos].reverse(), "2025-06-15", { timeZone: "UTC" }));
  });
  it("supports ascending order and fresh arrays", () => {
    const memories = onThisDay(photos, "2025-06-15", { timeZone: "UTC", order: "ascending" });
    expect(memories.map(({ key }) => key)).toEqual(["2020", "2024"]);
    expect(ids(memories[1]?.photos ?? [])).toEqual(["early", "a", "b"]);
    memories[1]?.photos.pop();
    expect(photos).toHaveLength(7);
  });
  it("uses capture offsets, otherwise the supplied zone, including year boundaries", () => {
    const photos = [
      photo("offset", "2024-01-01T00:30:00+14:00"),
      photo("zone", epoch("2024-01-01T00:30:00Z")),
    ];
    expect(
      ids(
        onThisDay(photos, "2025-01-01", { timeZone: "America/Los_Angeles" }).flatMap(
          ({ photos }) => photos,
        ),
      ),
    ).toEqual(["offset"]);
    expect(
      onThisDay(photos, "2024-12-31", { timeZone: "America/Los_Angeles" }).map(
        ({ key, photos }) => [key, ids(photos)],
      ),
    ).toEqual([["2023", ["zone"]]]);
  });
  it("sorts years by capture-calendar year when opposing offsets reverse instant order", () => {
    const photos = [
      photo("a", "2020-01-01T00:01:00+14:00"),
      photo("b", "2020-01-01T23:59:00-14:00"),
      photo("c", "2021-01-01T12:00:00Z"),
    ];
    expect(onThisDay(photos, "2022-01-01", { timeZone: "UTC" }).map(({ key }) => key)).toEqual([
      "2021",
      "2020",
    ]);
  });
  it("matches leap days exactly without February 28/March 1 substitution", () => {
    const photos = [
      photo("leap", "2020-02-29T12:00:00Z"),
      photo("feb", "2023-02-28T12:00:00Z"),
      photo("mar", "2023-03-01T12:00:00Z"),
    ];
    expect(onThisDay(photos, "2024-02-29", { timeZone: "UTC" }).map(({ key }) => key)).toEqual([
      "2020",
    ]);
    expect(onThisDay([photos[0] as TimelinePhoto], "2025-02-28", { timeZone: "UTC" })).toEqual([]);
    expect(onThisDay([], "2024-02-29", { timeZone: "UTC" })).toEqual([]);
    expect(onThisDay(photos, "2025-12-25", { timeZone: "UTC" })).toEqual([]);
  });
});

describe("typed fail-closed validation", () => {
  it.each([
    NaN,
    Infinity,
    -Infinity,
    0.5,
    -62_135_596_800_001,
    253_402_300_800_000,
    "2024-02-30T12:00:00Z",
    "1900-02-29T12:00:00Z",
    "0000-01-01T00:00:00Z",
    "2024-13-01T00:00:00Z",
    "2024-00-01T00:00:00Z",
    "2024-01-00T00:00:00Z",
    "2024-01-01T24:00:00Z",
    "2024-01-01T23:60:00Z",
    "2024-01-01T23:59:60Z",
    "2024-01-01T00:00:00.0001Z",
    "2024-01-01",
    "2024-01-01T00:00:00",
    "2024:01:01 00:00:00",
    "2024-11-03T01:30:00",
    "2024-03-10T02:30:00",
    "2024-01-01T00:00:00z",
    "2024-01-01T00:00:00+0000",
    "",
    null,
    undefined,
    {},
    new Date(0),
  ])("rejects unsupported capture %s", (capture) => {
    fails(() => groupPhotos([photo("bad", capture as number)], options), "invalid-capture-time");
  });

  it.each([
    "-00:00",
    "+14:01",
    "-14:01",
    "+15:00",
    "+00:60",
    "+1:00",
    "UTC",
    "",
    0,
    null,
  ])("rejects invalid capture offset %s", (offset) => {
    fails(() => groupPhotos([photo("bad", 0, offset as string)], options), "invalid-offset");
  });
  it("validates ISO offsets and rejects contradictory metadata", () => {
    fails(
      () => groupPhotos([photo("bad", "2024-01-01T00:00:00-00:00")], options),
      "invalid-offset",
    );
    fails(
      () => groupPhotos([photo("bad", "2024-01-01T00:00:00+15:00")], options),
      "invalid-offset",
    );
    fails(
      () => groupPhotos([photo("bad", "2024-01-01T00:00:00Z", "+01:00")], options),
      "invalid-offset",
    );
  });
  it("rejects instants or calendar projections crossing supported year boundaries", () => {
    for (const capturedAt of ["0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00"]) {
      fails(() => groupPhotos([photo("bad", capturedAt)], options), "invalid-capture-time");
    }
    fails(
      () => groupPhotos([photo("bad", epoch("0001-01-01T00:00:00Z"), "-01:00")], options),
      "invalid-capture-time",
    );
    fails(
      () => groupPhotos([photo("bad", epoch("9999-12-31T23:59:59Z"), "+01:00")], options),
      "invalid-capture-time",
    );
    for (const [date, timeZone] of [
      ["0001-01-01T00:00:00Z", "America/New_York"],
      ["9999-12-31T23:59:59Z", "Pacific/Kiritimati"],
    ]) {
      fails(
        () =>
          groupPhotos([photo("bad", epoch(date as string))], {
            ...options,
            timeZone: timeZone as string,
          }),
        "invalid-capture-time",
      );
    }
  });
  it.each([
    null,
    undefined,
    0,
    {},
    { id: "", capturedAt: 0 },
    { id: "  ", capturedAt: 0 },
    { id: 1, capturedAt: 0 },
  ])("rejects malformed photos %s", (item) => {
    fails(() => groupPhotos([item as TimelinePhoto], options), "invalid-photo");
  });
  it("rejects invalid collections, sparse arrays, and duplicate ids", () => {
    fails(() => groupPhotos(null as unknown as TimelinePhoto[], options), "invalid-photo");
    fails(() => groupPhotos(new Array<TimelinePhoto>(1), options), "invalid-photo");
    fails(() => groupPhotos([photo("same", 0), photo("same", 1)], options), "duplicate-id");
  });
  it.each([
    "Not/AZone",
    "",
    "  ",
    undefined,
    null,
    0,
  ])("requires a valid supplied zone, including empty collections (%s)", (timeZone) => {
    fails(() => groupPhotos([], { ...options, timeZone: timeZone as string }), "invalid-time-zone");
    fails(
      () =>
        groupPhotos([photo("offset", "2024-01-01T00:00:00Z")], {
          ...options,
          timeZone: timeZone as string,
        }),
      "invalid-time-zone",
    );
  });
  it.each([
    null,
    undefined,
    { ...options, unit: "week" },
    { ...options, order: "newest" },
  ])("rejects invalid options %s", (opts) => {
    fails(() => groupPhotos([], opts as TimelineOptions), "invalid-options");
  });
  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    undefined,
    "2",
  ])("rejects invalid column count %s", (columns) => {
    fails(
      () => buildTimelineSections([], { ...options, columns: columns as number }),
      "invalid-options",
    );
  });
  it("rejects missing section options", () => {
    fails(
      () => buildTimelineSections([], null as unknown as TimelineOptions & { columns: number }),
      "invalid-options",
    );
  });
  it.each([
    "2023-02-29",
    "1900-02-29",
    "2024-02-30",
    "0000-01-01",
    "2024-13-01",
    "2024-01-01T00:00:00Z",
    "bad",
    null,
  ])("rejects invalid memory date %s", (date) => {
    fails(() => onThisDay([], date as string, { timeZone: "UTC" }), "invalid-date");
  });
  it("validates nonmatching memory inputs and options before filtering", () => {
    fails(
      () => onThisDay([photo("invalid", "bad")], "2025-12-31", { timeZone: "UTC" }),
      "invalid-capture-time",
    );
    fails(() => onThisDay([], "2025-12-31", { timeZone: "Invalid/Zone" }), "invalid-time-zone");
    fails(
      () => onThisDay([], "2025-12-31", { timeZone: "UTC", order: "newest" as "ascending" }),
      "invalid-options",
    );
  });
  it("never echoes input in errors", () => {
    try {
      groupPhotos([photo("sensitive", "sensitive")], options);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toBe("PhotoTimelineError: Photo timeline: invalid-capture-time");
    }
  });
});
