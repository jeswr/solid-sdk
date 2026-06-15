# Model provenance ledger — Pod Health

Standing rule while Fable is unavailable: everything authored by **Claude Opus 4.8** is tagged so it
can be targeted for re-review / upgrade when Fable returns (commit trailers `Model: claude-opus-4-8`
+ `Provenance: Opus 4.8 (Fable unavailable) — re-review/upgrade candidate`, and an `AUTHORED-BY
Claude Opus 4.8` marker at the top of each source file).

| Artifact | Author | Notes |
|---|---|---|
| `src/vocab.ts` | Claude Opus 4.8 | the IRI vocabulary (health sector + app-local `ph:` + solid type-index) |
| `src/model.ts` | Claude Opus 4.8 | typed `@rdfjs/wrapper` accessors over the health sector ontology |
| `src/gpx.ts` | Claude Opus 4.8 | GPX track → typed workout + route |
| `src/serialise.ts` | Claude Opus 4.8 | `n3.Writer` Turtle serialisation |
| `src/type-index.ts` | Claude Opus 4.8 | Solid type-index read/write (discovery) |
| `src/store.ts` | Claude Opus 4.8 | pod I/O — `readHealth` / `writeHealth` |
| `src/index.ts` | Claude Opus 4.8 | public barrel |
| `src/entries.ts` | Claude Opus 4.8 | render-facing flattener — `listHealthEntries` lifts a HealthDocument into typed, RDF-free `HealthEntry` rows |
| `src/ui/HealthRecords.tsx` | Claude Opus 4.8 | framework-agnostic React health-records list view (the `./ui` export) |
| `src/ui/useHealthRecords.ts` | Claude Opus 4.8 | the view's data hook — reads via `readHealth` → `listHealthEntries`, injectable auth-fetch seam |
| `src/ui/format.ts` | Claude Opus 4.8 | pure presentation helpers (date/value/icon/error) |
| `src/ui/index.ts` | Claude Opus 4.8 | `./ui` barrel |
| `public/clientid.jsonld` | Claude Opus 4.8 | federation-ready Client-ID doc (the `fedapp:` block) |
| test suite (`test/*.test.{ts,tsx}`) | Claude Opus 4.8 | ~100 % data-layer + view coverage |
| `suite.json` | Claude Opus 4.8 | 3-ring suite tracking entry |
