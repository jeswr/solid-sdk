---
name: solid-media-log
description: Use when reading or writing media tracker records, changing the generated media-log profile, importing Letterboxd/Goodreads CSVs or projecting Netflix/Goodreads/Steam connector output.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Solid media log

Read README.md and the package-local federation-codegen and model-runtime skills before
changing the generated model. `codegen/media.ontology.ttl` declares only minted log terms;
borrowed vocabulary constraints are local to `codegen/media.shapes.ttl`. New schema.org
writes use `http://schema.org/`; native connector views read their existing HTTPS vocabulary.

`MediaLog` is a generated composite: LogEntry → CreativeWork, optional Review → Rating.
Every link projects one child. `src/model.ts` keeps the public calendar-date strings,
kind names, `review` body alias and cross-field policy. Never hand-edit `src/generated/`.
Change ontology/profile/config, run `pnpm run codegen --update-lock`, and run the drift test.
Do not modify the generator/runtime to work around admission gaps. The profile header and
README list vocabulary choices, narrowings and unsupported constructs.

`mediaRepository(storage, index)` owns shared pod I/O. It caches best-effort registration
and LWS hints once per session, uses returned URLs and observed ETags, reads at most six
resources concurrently, and reports partial results with skipped URLs and fixed reasons.
Only an unreadable primary container fails a normal load. For duplicate checking use
`load({complete: true, signal})`; do not import from an incomplete scan. Successful writes
whose read-back fails are unconfirmed, never rolled back. Delete failed empty reservations
only conditionally under their observed ETag.

CSV parsers are pure, bounded and indexed. Letterboxd identity ignores diary URLs; keep
separate dated rewatches and treat undated summaries as the same work. Invalid Goodreads
dates must not drop books. Strict UTF-8 decoding falls back to Windows-1252 with a notice.
Connector projections must not mutate the source graph. Group Netflix episodes across
resources; never infer whole-series completion or classify generic WatchActions as TV.

From the workspace root (Node 24, no network):

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-media-log
```

Tests use memory storage in both Solid and LWS modes and injected failure/abort seams.
Keep resource failures, stale discovery, timeout partials, write confirmation, cancellation,
CSV bounds and generated drift covered. `dist/` is untracked.
