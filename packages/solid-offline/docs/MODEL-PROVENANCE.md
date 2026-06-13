# Model Provenance

This file tracks which parts of `@solid/offline` were authored by an AI model,
which model, and any re-review/upgrade caveats. It exists so a later human or a
stronger model can find and re-review machine-authored code.

## Opus 4.8 (Fable unavailable) — re-review / upgrade candidate

The work below was authored by **Claude Opus 4.8** because **Fable was
unavailable** at the time. It is flagged as a **re-review / upgrade candidate**:
re-review (or regenerate with Fable) before treating it as fully trusted.

Each new file carries the matching top-of-file marker:

```
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
```

### P2 — page-driven proactive cache warmer (§3 + decisions 1 & 6)

New files:

- `src/warmer-rdf.ts` — pure RDF helpers: seed derivation from a WebID profile
  (`deriveSeeds`, Type-Index-first), container `ldp:contains` enumeration
  (`containerChildren`), Type Index target extraction (`typeIndexTargets`),
  ACL-URL derivation (`aclUrlFor` / `aclFromLinkHeader`), and `WAC-Allow` parsing
  (`parseWacAllow` / `userCanRead`).
- `src/warmer.ts` — the bounded-BFS warmer engine (`warm`), budget resolution
  (`resolveBudget`, `DEFAULT_WARM_BUDGET`), and the browser triggers
  (`onIdle`, `createWarmController` — post-login idle + reconnect re-warm).
- `test/warmer.test.ts` — headless unit tests (URL-routed mock fetch + Turtle
  fixtures) for all of the above.

Files modified for P2 (not newly authored, so no top-of-file marker):

- `src/types.ts` — `WarmBudget` (spec field names + back-compat aliases),
  `WarmConfig` (`warmOnLogin`/`rewarmOnReconnect`), `OfflineClientConfig.fetch`,
  `OfflineClient.warm()`.
- `src/index.ts` — wires the page-driven warmer into `createOfflineClient`
  (`register()` starts it on idle; `warm()` runs it on demand; `close()` stops
  it) and re-exports the warmer surface.
- `README.md` — P2 documentation.

### Re-review focus areas

- Seed/vocabulary coverage: only `pim:storage`, `solid:public/privateTypeIndex`,
  `ldp:inbox`, `ldp:contains`, `solid:instance(Container)` are followed. A real
  pod may surface other linkage worth warming.
- Binary/large-resource heuristics (`BINARY_TYPE_PREFIXES`, `LARGE_RESOURCE_BYTES`
  = 5 MB) are conservative guesses, not measured.
- The reconnect re-warm currently re-issues the full BFS and relies on the P1 SWR
  layer to make it cheap (mostly 304s) rather than doing a dedicated
  ETag-only sweep. Worth revisiting alongside P3.
- Browser triggers (`requestIdleCallback`, the `online` event) are unit-tested
  with injected globals but not yet exercised against a live pod.
