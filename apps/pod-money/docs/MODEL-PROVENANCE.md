# Model provenance ledger — pod-money

Standing rule (suite-wide, while Fable is unavailable): tag everything authored by **Claude Opus
4.8** so it can be targeted for re-review / upgrade when Fable returns. Commits carry the trailers
`Model: claude-opus-4-8` and `Provenance: Opus 4.8 (Fable unavailable) — re-review/upgrade
candidate`; new source files carry an `AUTHORED-BY Claude Opus 4.8` top-of-file marker.

| Date | Artifact | Author |
|---|---|---|
| 2026-06-15 | Initial data-layer core — `src/vocab.ts`, `src/model.ts`, `src/typeIndex.ts`, `src/serialise.ts`, `src/store.ts`, `src/clientid.ts`, `src/index.ts`; the vitest suite; `public/clientid.jsonld`; config + tracking (`suite.json`, gate, `.roborev.toml`) | Claude Opus 4.8 (@jeswr PSS agent) |
