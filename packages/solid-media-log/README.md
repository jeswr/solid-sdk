<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-media-log

Generated personal media records for films, television, books and games. Separate from
`solid-listening` (scrobbles) and any music-library model. The Suite `/media` app is its first consumer.

`codegen/media.ontology.ttl` projects the canonical federation media sector's
`https://jeswr.org/ns/sectors/media#CreativeWork`, rooted in the suite core. The profile
starts with the sector's `CreativeWorkShape` singleton `dct:title` constraint, narrows it
to a nonblank title and documents all omitted advisory/music/playback constraints in its header.

The generated `MediaLog` composite spans one `log:LogEntry` (`#it`) and one
`media:CreativeWork` (`#work`) joined by `core:about`, with optional singleton `schema:Review`
(`#review`) and `schema:Rating` (`#rating`) children. `log:` is
`https://jeswr.org/ns/media-log#`. Work kind uses `schema:additionalType` and the matching
`rdf:type`: `http://schema.org/Movie`, `TVSeries`, `TVEpisode`, `Book`, or `VideoGame`.
Work properties are `dct:title`, `dc:creator` (literal display credit), `dct:issued`
(year-only release/publication literal), and `schema:image`. Log properties are `log:status` (want,
in-progress, finished, abandoned), `schema:startDate`, `schema:endDate`,
`schema:review` → `schema:Review` (`schema:reviewBody`, `schema:reviewRating` →
`schema:Rating` / `schema:ratingValue`, decimal half-star enum 0.5–5),
`log:repeatCount` (additional completions), `log:progress`, `log:progressUnit` (page/episode),
`log:sourceLabel` (import label), and `prov:wasDerivedFrom` (original imported subject or external work URL).

All RDF accessors, field guards, subject conventions, build, parse and serialization are
**generated** in `src/generated/`; never edit those files. `src/model.ts` is the thin facade:
it converts public calendar-date strings to generated Dates, maps kind names to IRIs, stamps
the work's schema type through a generated wrapper, validates before publishing and adds only
cross-field/UI policy. Parsing uses `@jeswr/fetch-rdf`; generated serialization uses `n3.Writer`.

```ts
import { createMediaRepository } from '@jeswr/solid-media-log';
const repository = await createMediaRepository({ fetch: authenticatedFetch, storage: podRoot, webId });
const saved = await repository.save({title:'The Last Lighthouse', kind:'film', status:'want'});
await repository.save({...saved.data, status:'finished', finished:'2026-11-11', rating:4.5}, saved);
const {records, incomplete} = await repository.load();
```

The repository best-effort registers `log:LogEntry` once per repository session and uses
`media/`, one resource per log. Registration failure logs a fixed message without pod data;
load/save still work. LWS creation hints are cached and passed to each create. Existing
registered containers win; stale/unreadable registrations are skipped. Creates reserve a
server-returned URL before writing subject-relative RDF; edits require the observed ETag.
Failed reservation reads and writes best-effort delete only the empty reservation under its
observed ETag (or the create response's own ETag). A follow-up HEAD validator is never used
for cleanup. Without a safe validator, the empty reservation stays and is ignored by loads.
A successful write with failed read-back returns `unconfirmed: true` and a null ETag; the app
keeps it visible and asks for refresh before the next edit, rather than reporting a rollback.

Discovery follows scoped SDK locations and paginated listing. View scans cap source locations
at 32, use six concurrent resource reads and a 20-second deadline, and return partial records
with `incomplete` and `skipped: [{url, reason}]`. There is no 1,000-record cap. Only unscanned
sources (discovery/listing failures, source caps or timeouts) set `incomplete` and prevent imports.
Individual invalid entries and forbidden/non-RDF resources are rejected and reported in `skipped`
without making the library incomplete. Empty reservations and recognised connector documents
that project no media are ignored. Discovery is retried on every load; initialisation failures
are not retained in later scans. Initialisation, including container HEAD/create, has a 20-second
deadline even for complete scans. Only an
unreadable primary container (first page, outside a timeout) fails the load. Other source failures
never discard readable records. `load({complete: true, signal})` scans every source without the
view's deadline, still at six reads at a time; imports use it to check duplicates against the
entire library and refuse to write when that scan is incomplete. Callers can cancel this scan.
`mediaRepository(storage, index)` is the injected-client seam for other hosts.
`knownSolid: true` explicitly selects the SDK Solid transport for demo pods that do not expose
capability discovery; do not infer this option from arbitrary pod data.

`connectorEntries` reads **the existing typed pod-connectors wrappers**, without mutating imports:

- Netflix `schema:WatchAction`: title and `startTime`; `groupNetflixEntries` groups episode titles
  with explicit `Season N`, `Series N`, `Limited Series` or `Part N` markers after a show name
  into one in-progress series across documents. Progress counts distinct episode titles, so
  rewatches do not inflate it. Film subtitles and `Episode IV` alone do not imply TV. Standalone titles
  are films by default and can be corrected by the user. No episode count implies series completion.
- Goodreads `schema:Book`: title, author, personal rating and reading shelf. The existing
  adapter discards Date Read, review and read count; these cannot be reconstructed from RDF.
- Steam `schema:VideoGame`: title, source link and playtime; positive playtime means in progress,
  ownership alone means want. Playtime never implies completion.

Provider names require matching source provenance or a canonical provider URL; other typed
works are labelled Imported. A generic WatchAction without Netflix provenance is omitted: it does not identify a work kind
or prove completion. HTTPS schema.org connector data is read through the connector's native typed
views. Work-kind values accept both HTTP and HTTPS IRIs; all new tracker writes use HTTP.
Legacy HTTPS predicate graphs are not rewritten or interpreted as HTTP predicates.

Editing a connector item creates a separate log whose origin hides that original from the
tracker's view; the connector document remains untouched. Imported-only items remain discoverable.

`parseLetterboxdCsv` accepts diary, watched, ratings, reviews and watchlist exports; pass `"want"`
for watchlists (their headers cannot distinguish them from watched exports). `parseGoodreadsCsv`
uses Exclusive Shelf, My Rating, Date Read, My Review, publication year and Read Count. A
malformed Date Read drops only the date. Custom shelves map `dnf` to abandoned, `paused` to
in progress and unknown names to want. A previous Date Read on a currently-reading/to-read shelf is not the current cycle's finish;
repeat counts are retained. Zero means
unrated. Both pure parsers reuse pod-connectors' CSV tokenizer, accept quoted multiline text/BOM,
cap input at 4 Mi characters and 5,000 rows, report invalid/duplicate rows and never fetch URLs.
The browser additionally caps file bytes before reading, decodes UTF-8 strictly and falls back
to Windows-1252 with a preview notice. Identity is normalised kind/title/year plus watched date
when present, not Letterboxd's differing diary/film URLs. An undated watched/ratings row matches
any dated log of the same work; distinct dated rewatches remain distinct. Duplicate detection
uses an indexed map so large imports do not repeatedly scan titles. A finished row matching
an undated want/in-progress record updates that record's status, finish date, rating and review
through the usual conditional save, retaining its URL and any metadata absent from the CSV.
For example, importing watchlist.csv then diary.csv completes the existing watchlist item.
An existing finished record wins; merging richer metadata into finished duplicates remains
a separate feature. `mediaImportIndex().completionTarget(entry)` exposes the pending item
to hosts that implement import jobs.
The app runs imports as one cancellable job, publishes optimistic additions together and settles
six items per batch, reports counts, and emits one summary toast. Cancelling stops new batches;
already-started writes are allowed to settle and stay in the library. Formula-like review/title text stays inert.

`mediaStats(entries, year)` counts only dated finished logs. It groups TV episodes with TV,
uses only rated completions in the average, and does not invent dates or distribute repeat
counts across months. Charts and tables are app presentation.

Generator gaps: closed admission rejects `sh:maxLength`; the facade enforces title/creator/source
limits of 500 and review limit of 20,000 characters. Singleton `trim` config is also rejected
(only sets support it); title trimming stays facade policy. Date order/status consistency is a
cross-field facade rule. `xsd:gYear` is unsupported, so the year remains a bounded integer.
Composite links project one child and do not support structural predicate aliases; this profile
uses singleton Review and Rating children and leaves legacy predicate migration for later.
The flat projection reserves link names (`review`), so the generated body field is `reviewText`;
the facade preserves the public `review` property. IRI enums are supported: the shelf remains a
literal enum because it describes a Record, not an Action. `core:about` stays the work link because
`media:consumedWork` has ListeningActivity domain. Absolute pages/episodes cannot become
`media:completionFraction` without a known total. Borrowed terms are not re-declared in the ontology.
No generator/runtime files or hand-written RDF accessor classes were added.

Run `pnpm run codegen --update-lock` after reviewing input changes, then the package tests.
The drift test runs the actual codegen script into a temporary directory and compares every
artifact byte-for-byte. Build copies generated JS/declarations; `dist/` is untracked. Biome,
TypeScript and Vitest are the workspace-root tools; no new third-party library was introduced.
