<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Photo capture timeline

Pure TypeScript: no React, hooks, I/O, clock, or device time-zone defaults.
Import the public API from `./index`.

```ts
const photos = [
  { id: "https://example.org/photos/snow", capturedAt: "2020-02-29T10:00:00+05:45" },
  { id: "https://example.org/photos/river", capturedAt: 1709208000000 },
];
const options = { unit: "day", timeZone: "Europe/London" } as const;
const groups = groupPhotos(photos, options);
const grid = buildTimelineSections(photos, { ...options, columns: 3 });
const memories = onThisDay(photos, "2028-02-29", { timeZone: "Europe/London" });
```

## Capture contract

`TimelinePhoto` has a unique, nonblank `id` and `capturedAt` as either:

- An integer epoch-millisecond instant; optional `captureOffset` preserves an
  original offset such as `+05:45` from EXIF.
- A strict `YYYY-MM-DDTHH:mm:ss[.S|SS|SSS](Z|±HH:mm)` timestamp. Its suffix is the
  capture offset, including `Z`; any additional `captureOffset` must agree.

The capture offset determines the calendar date when present. Otherwise the
explicit `timeZone`, validated by `Intl.DateTimeFormat`, determines the date.
The zone is required and validated even for empty collections or offset-bearing
photos. Civil dates and instants must remain within Gregorian years 0001–9999.
Offsets range through ±14:00. `-00:00` is an unknown offset and is rejected.

Unresolved local strings (including EXIF `DateTimeOriginal`), `Date` objects,
date-only strings, leap seconds, rollover dates, `24:00`, and sub-millisecond
precision are rejected. The caller must resolve civil EXIF times to instants
before passing them here; the library never chooses a DST fold/gap interpretation
or substitutes upload/modified time. Pass an epoch instant when a stored `Z`
timestamp is merely a transport representation and its original offset is unknown.

All validation failures throw `PhotoTimelineError` with a public `code`. Error
messages contain no input values. Every photo is validated, including those that
would not match the memories filter. Duplicate ids and sparse arrays are rejected.

## Ordering and memories

`groupPhotos` returns `{ key, photos }` groups by day, month, or year, with
zero-padded calendar keys. Calendar groups sort descending by default, or
ascending with `order`. Within a group, capture instants follow the same order;
equal instants always sort by ascending id using locale-independent UTF-16 order.
Grouping first by calendar key keeps sections chronological even when different
capture offsets reverse the order of instants across a calendar boundary.

`onThisDay` takes a Gregorian `YYYY-MM-DD` reference date and returns groups keyed
by capture-calendar year. It selects the exact month/day in strictly earlier
years. Current/future years are excluded; February 29 has no fallback. Year groups
and captures within them follow `order`, with the same ascending id tie-breaker.

All returned arrays are fresh. Photo objects retain their original identity and
extra fields; input arrays and objects are never mutated.

## Virtualized grid model

`buildTimelineSections` accepts a positive integer `columns` and returns:

- `sections`: calendar key and photos, `startPhotoIndex` in the flattened photos,
  and a half-open `[headerIndex, endIndexExclusive)` range in `rows`.
- `rows`: discriminated header/photo rows with unique keys. Photo rows include
  `startPhotoIndex`; partial rows never spill into the next section.
- `stickyHeaderIndices`: row indices of every section header.
- `photoCount`: total photos, excluding headers.

For a visible row, the active sticky header is the section whose half-open range
contains that row. A virtualizer can retain that header when it would otherwise
be unmounted, and use the next header as its push-off boundary. Stable keys depend
on the section key and the first photo id in each row. Row measurement, responsive
column counts, justified pixel geometry, and header localization belong to the
caller; this model sets no UI dimensions.
