<!-- AUTHORED-BY Codex GPT-6 -->

# sst-8xm.59 / T-071 lane status

Date: 2026-10-26. Branch: `lane/sst-8xm.59`.
Original base: `2083a623794c08a70ec4cbfadd55cc1357e7fb6d`.
Resumed from `870dd1ad` after reading the original lane brief, ADR-001,
ADR-007 (including the 2026-10-26 amendment), ADR-009, planning STATUS,
and the package and repository guidance.

T-071 is implemented. The answered QUESTIONS.md was deleted. No dependencies,
package manifests, lockfiles, other packages, or other checkouts were changed.
No push, PR, branch switch, or remote fetch/merge was performed.

## Commits

- `15d217b3` — `feat: implement LocalIndex queries snapshots and LRU`:
  SELECT/ASK/CONSTRUCT and disposable SELECT cursor streams; RDF/JS bindings;
  single-member platform gzip N-Quads snapshots; sniffed gzip/zstd restore;
  graph listing, configurable 2,000,000-quad cap and graph LRU; ordered async
  operations and persistence load/save; fake query injection and typed unsupported
  errors; real/fake acceptance tests, 1,000-graph correctness, and lifetime tests.
- `937d5953` — `feat: persist browser RDF indexes in IndexedDB`:
  exported IndexedDB persistence adapter with database/key isolation; browser
  indexes use it by default; transaction/error tests; updated README and skill.
- Final commit — `docs: record T-071 completion and validation`: this status report.

The earlier design-question/status commits (`73ca1a97`, `870dd1ad`) remain in
history. New commits name the actual authoring model, Codex GPT-6, in provenance
markers and trailers.

## Gate results

All required checks passed before the final commit (exit status 0):

```sh
pnpm --filter @jeswr/rdf-engine run lint && pnpm --filter @jeswr/rdf-engine run build && pnpm --filter @jeswr/rdf-engine run typecheck && pnpm --filter @jeswr/rdf-engine run test
pnpm exec turbo run build typecheck test --filter=...@jeswr/rdf-engine
pnpm run lint:root
git diff --check
```

- Package lint: 27 files, no fixes. Build and typecheck passed.
- Tests: 9 files, 100 tests passed. Configured 90% thresholds passed:
  statements 99.78%, branches 98.06%, functions 99.33%, lines 99.75%.
- Tests include shared fake/real graph lifecycle, snapshot round-trip, LRU/cap,
  persistence ordering/failures, disposal during loading, and invalid inputs.
  Real-only tests cover 1,000-graph SELECT/ASK/CONSTRUCT/streams, zstd (including
  skippable frames), SparqStore.fromCompressed compatibility, blank nodes,
  actual WASM eviction/removal, cursor exits/errors and store release.
- Dependant gate: 3 successful Turbo tasks. Only rdf-engine was in scope;
  no current workspace manifest depends on it.
- Root lint and every guard passed: 83 manifests scanned by the SDK layer guard;
  contrast check 74 pairs, zero failures.
- Whole-workspace gates and gate:full were not run, as the lane brief instructs.

Additional browser acceptance passed with the installed Chromium/Playwright and
esbuild, using a temporary harness and bundle outside the checkout:

```sh
node /tmp/sst-8xm.59-browser-check.mjs
```

It bundles the browser entry, serves the installed WASM locally, and exercises
real browser SELECT/streaming, single-member gzip N-Quads, default IndexedDB
persistence across page reloads, independent database/key isolation, and
persisted removal. No dependencies or browser tooling were installed.

## Conservative interpretations and operational limits

- LRU refreshes on put and successful has; queries/list leave recency unchanged.
  A single graph exceeding maxQuads rejects before mutation. Restore applies
  the cap in graph order.
- SELECT streams are single-use async iterators with dispose(). Sparq 0.1.5
  materializes results in WASM; JavaScript conversion pulls 256-row batches.
- N-Quads cannot represent empty graphs, so snapshots omit them; other graph
  contents and RDF term links survive. Separate recency metadata is not encoded.
- A save failure rejects the mutation promise but retains updated in-memory
  data, permitting a later save. Independent browser indexes should use separate
  database/key settings; the default key represents one logical index.
- The fake has no SPARQL evaluator or zstd decoder. It throws
  FakeEngineUnsupportedError unless query handlers are supplied; gzip lifecycle
  and persistence use the shared implementation.

## Dependency policy, review, unfinished work and questions

check:packages was not run: no dependency was added or proposed. The pinned
Sparq version, lockfile, coverage thresholds and installed-WASM budget remain
unchanged. No dist artifacts were committed.

Roborev remains unavailable (`command -v roborev` found no executable), so no
per-commit review verdict could be obtained. No review tooling was installed.
This is the only external review limitation; no implementation or required
validation is unfinished or blocked. Open design questions: none.

## Fix round 2 — review ca6adbd7eede

Resumed from `ca6adbd7` on 2026-10-26. Read the complete review at
`solid-suite-tracker/lanes/reviews/solid-sdk-lane-sst-8xm.59-ca6adbd7eede.md`,
both earlier briefs, and the applicable package, repository and ADR guidance.
Addressed exactly its two findings, with LocalIndex membership as the source
of truth as directed by the fix brief.

Commits for this round:

- `ae90c058` — `fix: align index graph membership and SELECT comments`:
  backend deltas explicitly create added graph names (including empty graphs)
  and drop removed or evicted graph names. Restore synchronizes graph names
  and quads with the capped replacement contents. SELECT comment skipping
  accepts standalone CR as well as LF and CRLF, including within prologues.
  Real-engine regressions cover empty/populated graph creation, replacement,
  removal, re-creation, empty-graph and blank-node graph eviction, restoration
  into an existing index with overlapping/stale graphs and quad caps, empty
  restores, and both SELECT methods with each supported line ending.
- Final commit — `docs: record round two fixes and validation`: this update,
  committed last after all required gates passed.

Regression verification first reproduced seven failing cases against the old
implementation. The targeted real-engine contract then passed all 36 tests
after the fixes. All final gates passed with exit status 0:

```sh
pnpm --filter @jeswr/rdf-engine run lint && pnpm --filter @jeswr/rdf-engine run build && pnpm --filter @jeswr/rdf-engine run typecheck && pnpm --filter @jeswr/rdf-engine run test
pnpm exec turbo run build typecheck test --filter=...@jeswr/rdf-engine
pnpm run lint:root
git diff --check
```

- Package lint: 27 files checked. Build and typecheck passed.
- Tests: 9 files, 109 tests passed. Coverage: statements 99.78%, branches
  98.10%, functions 99.35%, lines 99.75%; configured 90% thresholds passed.
  `sparq-index.ts` has 100% coverage in all four measures.
- Dependant gate: 3 successful tasks; only rdf-engine was in scope.
- Root lint and guards passed, including 83 SDK manifests and 74 contrast
  pairs with zero failures. Whole-workspace gates were not run, as the lane
  brief directs.

No dependencies were added; check:packages was unnecessary. No manifests,
lockfiles, other packages or checkouts were changed. No dist artifacts were
committed. No push, PR, branch switch or remote fetch/merge was performed.
The existing gzip N-Quads format still omits empty graphs; restore rebuilds
membership from the graphs represented in the snapshot, without adding a new
snapshot format.

Roborev is still unavailable (`command -v roborev` found no executable), so
automated per-commit review could not run; no review tooling was installed.
Both supplied review findings are fixed. No implementation or required gate
is unfinished or blocked. Open questions: none.
