<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-media-log

Generated personal media records for films, television, books and games. Separate from
`solid-listening` (scrobbles) and any music-library model. The Suite `/media` app is its first consumer.

`codegen/media.ontology.ttl` projects the canonical federation media sector's
`https://jeswr.org/ns/sectors/media#CreativeWork`, rooted in the suite core. The profile
starts with the sector's `CreativeWorkShape` singleton `dct:title` constraint, narrows it
to a nonblank title and documents all omitted advisory/music/playback constraints in its header.

The generated `MediaLog` composite spans exactly one `log:LogEntry` (`#it`) and one
`media:CreativeWork` (`#work`) joined by `core:about`. `log:` is
`https://jeswr.org/ns/media-log#`. Work kind uses `schema:additionalType` and the matching
`rdf:type`: `https://schema.org/Movie`, `TVSeries`, `TVEpisode`, `Book`, or `VideoGame`.
Work properties are `dct:title`, `dc:creator` (literal display credit), `dct:issued`
(year-only release/publication literal), and `schema:image`. Log properties are `log:status` (want,
in-progress, finished, abandoned), `schema:startDate`, `schema:endDate`,
`schema:ratingValue` (decimal half-star enum, 0.5–5), `schema:reviewBody`,
`log:repeatCount` (additional completions), `log:progress`, `log:progressUnit` (page/episode),
`dct:source` (import label), and `prov:wasDerivedFrom` (original imported subject or external work URL).

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

The repository registers `log:LogEntry` in the private Type Index and uses `media/`, one resource
per log. Existing registered containers win. Creates reserve a server-returned URL before
writing subject-relative RDF; edits require the observed ETag. Conflicts surface to the caller
for refresh/review. Discovery follows the SDK's scoped, validated locations and paginated listing.
It caps source locations at 32 and listed documents at 1,000 with a 20-second read signal;
`incomplete` makes those caps visible. Transport/list/permission errors propagate, including
later-page failures. `mediaRepository(storage, index)` is the injected-client seam for other hosts.
`knownSolid: true` explicitly selects the SDK Solid transport for demo pods that do not expose
capability discovery; do not infer this option from arbitrary pod data.

`connectorEntries` reads **the existing typed pod-connectors wrappers**, without mutating imports:

- Netflix `schema:WatchAction`: title and `startTime`, finished, initially on TV because the
  adapter does not identify film versus series. Users can correct kind when editing.
- Goodreads `schema:Book`: title, author, personal rating and reading shelf. The existing
  adapter discards Date Read, review and read count; these cannot be reconstructed from RDF.
- Steam `schema:VideoGame`: title, source link and playtime; positive playtime means in progress,
  ownership alone means want. Playtime never implies completion.

Provider names require matching source provenance or a canonical provider URL; other typed
works are labelled Imported. A generic WatchAction is never attributed to Netflix by its type alone.

Editing a connector item creates a separate log whose origin hides that original from the
tracker's view; the connector document remains untouched. Imported-only items remain discoverable.

`parseLetterboxdCsv` accepts diary, watched, ratings, reviews and watchlist exports; pass `"want"`
for watchlists (their headers cannot distinguish them from watched exports). `parseGoodreadsCsv`
uses Exclusive Shelf, My Rating, Date Read, My Review, publication year and Read Count. A
previous Date Read on a currently-reading/to-read shelf is not the current cycle's finish;
repeat counts are retained. Zero means
unrated. Both pure parsers reuse pod-connectors' CSV tokenizer, accept quoted multiline text/BOM,
cap input at 4 Mi characters and 5,000 rows, report invalid/duplicate rows and never fetch URLs.
The browser additionally caps file bytes before reading. Formula-like review/title text stays inert.

`mediaStats(entries, year)` counts only dated finished logs. It groups TV episodes with TV,
uses only rated completions in the average, and does not invent dates or distribute repeat
counts across months. Charts and tables are app presentation.

Generator gaps: closed admission rejects `sh:maxLength`; the facade enforces title/creator/source
limits of 500 and review limit of 20,000 characters. Singleton `trim` config is also rejected
(only sets support it); title trimming stays facade policy. Date order/status consistency is a
cross-field facade rule. No generator/runtime files or hand-written RDF accessor classes were added.

Run `pnpm run codegen --update-lock` after reviewing input changes, then the package tests.
The drift test runs the actual codegen script into a temporary directory and compares every
artifact byte-for-byte. Build copies generated JS/declarations; `dist/` is untracked. Biome,
TypeScript and Vitest are the workspace-root tools; no new third-party library was introduced.
