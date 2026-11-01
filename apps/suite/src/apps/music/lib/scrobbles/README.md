<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Scrobble imports (MUS-L6, sst-f1ig)

Pure TypeScript with no I/O or new dependencies. Import from `./index`:

```ts
const result = importScrobbles(
  { listenBrainz: jsonText, lastFm: csvText },
  { now: new Date("2026-10-26T12:00:00Z") },
);
// result.listens: { playedAt, artist, track, album?, durationMs?, mbids, source }[]
// result.warnings: { source, line, code, message, field? }[]
```

`parseListenBrainz(text, { now })` and `parseLastFm(text, { now })` import individual
sources. `now` is required; no system clock is read. `source` is `listenbrainz` or
`lastfm`. `mbids` holds optional `recording`, `release`, and `artists` UUID values.
Display text is preserved, including quoted newlines. Empty albums are omitted.

ListenBrainz accepts a JSON array or one JSON listen per nonblank physical line.
A single leading BOM is accepted. CSV requires unique, exact lowercase headers
`artist`, `album`, `track`, `timestamp` in any order; extra named columns are
ignored. Album cells may be empty. RFC 4180 quoting (including doubled quotes and
embedded newlines), CRLF and LF separators are supported; malformed quoting and
bare CR separators are rejected. CSV is never delimiter-sniffed or reinterpreted.

Timestamps are integer epoch seconds, or CSV `DD Mon YYYY HH:MM` with English
month abbreviations in UTC. Invalid dates and rollovers are rejected. The range
is inclusive from 2002-01-01 through `now + 1 day`. Missing/invalid required
fields, invalid optional album/duration/metadata shapes, wrong-width CSV rows,
and dates outside the window skip the row with `INVALID_LISTEN`. MBIDs must match
the lowercase UUID shape; each invalid value is dropped with `INVALID_MBID` and
a `field` path. Artist MBID lists retain valid entries. Warnings retain source
order and one-based physical record-start lines, including multiline records.

Duplicates match lowercased artist/track with all whitespace removed and a time
difference of at most 30 seconds, within or across sources. More populated
optional fields win: album, duration, recording UUID, release UUID and a nonempty
artist UUID list each count once. Ties prefer ListenBrainz, then earliest time,
then input order. Candidates are considered in that priority order; each retained
candidate suppresses only matching listens within its own 30-second window.
This avoids transitive merging through discarded records. Fields are never
combined. Output is sorted by numeric time, then artist and track using Unicode
code-unit order, independent of host locale.

`MAX_EXPORT_BYTES` (64 MiB, UTF-8 including BOM) and `MAX_LISTENS` (1,000,000 raw
rows, including invalid/duplicate rows, excluding the CSV header and blank JSON
Lines) apply across both sources together. Constant-time code-unit size rejection
precedes bounded, allocation-free UTF-8 counting. Record-boundary/count preflight
precedes JSON parsing, field decoding, normalization and sorting. Boundary scans
necessarily inspect input to determine byte/row counts, using constant auxiliary
space. Only after both limits pass are rows materialized. Matching uses three
31-second time buckets per artist/track, avoiding quadratic duplicate searches.

Malformed exports and unsupported API inputs throw `ScrobbleError` with
`code: "INVALID_EXPORT"`; exceeded limits throw `code: "EXPORT_TOO_LARGE"`.
Error and warning messages never echo supplied content. No partial result is
returned on file errors. See root `QUESTIONS.md` for conservative interpretations.
