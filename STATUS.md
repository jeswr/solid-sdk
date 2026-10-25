<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane report — sst-8xm.58 / T-070

Updated: 2026-10-25. Branch: `lane/sst-8xm.58`.

Status: single-document implementation complete and package gates passing.
QUESTIONS.md item 1 is resolved using the exact architect answer supplied in the
Round 2 instruction. LocalIndex graph lifecycle is implemented and exercised by
the shared contract. The broader LocalIndex surface remains T-071 under the
conservative interpretation of the original task split described below.

## Commits

Round 2 implementation:

- `f1c16686` — `feat: implement lazy RDF document engines`: lazy loader with
  wasmUrl support, Node wasm-node entry, RDF/JS datasets, parse/serialize,
  SHACL validation, RDFC-1.0 canonicalization, WASM-free n3 fake, typed
  FakeEngineUnsupportedError, injected validation reports/callbacks, shared and
  real-only contracts, loader/error/disposal/store-lifetime tests; resolve
  QUESTIONS.md item 1. Pins only the authorized dependencies.
- `585f1a63` — `feat: add RDF index graph lifecycle`: put/remove/has/size/dispose
  on fake and real indexes, copied and deduplicated resource graphs, owned WASM
  store cleanup, engine-driven disposal, shared graph lifecycle contract, and
  index store-lifetime assertions.
- `56b1f6b6` — `test: enforce installed RDF bundle budget`: content-hashed static
  WASM copy script and manifest, installed-artifact measurement script,
  bench/bundle.json, budget/copy tests, and package README with fake limitations.
- `docs: record rdf-engine lane verification` — this final STATUS.md update.

Round 1 history is retained: `1ccaf888` asked the fake-contract question and
`7d4466ac` recorded that blocker. The architect's Round 2 answer resolves it.
Every new commit uses the required Conventional Commit subject, author identity,
unsigned commit command and GPT-6.1-Sol provenance trailer.

## Gate results

Final commands ran in this checkout on Node v24.22.1 / pnpm 10.4.1 before the
last commit:

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/rdf-engine run lint` | PASS; 20 files checked |
| `pnpm --filter @jeswr/rdf-engine run build` | PASS |
| `pnpm --filter @jeswr/rdf-engine run typecheck` | PASS |
| `pnpm --filter @jeswr/rdf-engine run test` | PASS; 41 tests across 6 files, including real Node WASM |
| `pnpm run lint:root` | PASS; Biome, lockfile transport, app workspace and fetch guards |
| `pnpm --filter @jeswr/rdf-engine run bench:bundle` | PASS; regenerated the committed installed-artifact measurement |
| `git diff --check` | PASS |

Coverage: statements 99.48%, branches 97.43%, functions 100%, lines 99.42%.
The existing 90% thresholds remain enforced. The shared contract runs against
both engines for Turtle, TriG, N-Triples, N-Quads, ground canonicalization
(including Unicode canonical escapes/order), LocalIndex graph lifecycle and
engine disposal. The separate real-only contract covers JSON-LD, SHACL and
blank-node canonicalization. Fake tests prevent runtime Sparq imports and check
typed unsupported-operation errors and injected validation.

The leak test performs 100 repeated document/index cycles, accounts for at least
600 successful store allocations, and verifies all are freed. Actual live owned
stores' heapBytes() measurements return to the zero-byte baseline after each
cycle and after exceptions; a positive peak ensures the measurement is not
vacuous. Both successful and failed materialization, serialization and validation
paths are exercised. Returned datasets retain no WASM handle. These tests cover
the raw Store bindings used by the facade, including the shipped wasm-node
module, rather than relying on garbage collection.

No workspace package currently depends on rdf-engine (manifest search found
only its own name), so no dependent gate applies. No whole-workspace gate or
`gate:full` was run, per the lane brief's explicit instruction. Generated dist,
coverage and dependencies remain ignored. No app output was committed.

`roborev` is unavailable and the checkout has no installed post-commit review
hook, so no automated review verdict was produced. No reviewer configuration,
external installation or other checkout was changed.

## Dependency policy and installed bundle

`pnpm run check:packages @sparq-org/sparq n3 @rdfjs/types @types/n3` — PASS in
full mode (4 packages; registry existence and age checks passed), before adding
dependencies. Runtime pins: @sparq-org/sparq 0.1.5, n3 2.0.3, @rdfjs/types 2.0.1;
dev pin: @types/n3 1.26.1. No other direct dependency was added. Sparq's published
fzstd dependency is recorded transitively in the lockfile.

Manifest changes used filtered `pnpm add --lockfile-only`, with writable
store/cache/state directories under `/tmp/sst-8xm-58-pnpm-*`. Unrelated pnpm
re-resolution was removed from the lockfile; only the rdf-engine importer and
required Sparq/fzstd resolution records changed. The subsequent command passed:

```sh
pnpm --filter @jeswr/rdf-engine install --frozen-lockfile --ignore-scripts \
  --config.store-dir=/tmp/sst-8xm-58-pnpm-store \
  --config.cache-dir=/tmp/sst-8xm-58-pnpm-cache \
  --config.state-dir=/tmp/sst-8xm-58-pnpm-state
```

No lifecycle scripts were enabled. No github pin or locally built WASM is used.
The installed browser WASM measures **3,909,895 B raw**, **1,444,432 B gzip
(level 9)**, within **4,194,304 B raw** / **1,572,864 B gzip**. The version,
artifact path, SHA-256, measured sizes and ceilings are committed in
`packages/rdf-engine/bench/bundle.json` and verified by the package test.

## Scope, gaps and open questions

Conservative scope choice: the original task assigns full LocalIndex querying,
selectStream, snapshot/restore, persistence and LRU eviction to T-071. Round 2
also requests LocalIndex behavior in the shared contract, so this lane supplies
the graph lifecycle foundation and tests it on both engines; it does not pull
that entire later task into T-070. The scope clarification received no answer
during implementation. If Round 2 intended the full T-071 surface here, those
methods remain unfinished and need dispatcher direction. Policy evaluation,
form derivation and parse crossover benchmarks remain T-072 as originally
assigned. Those later tasks already exist; no new markdown work tracker was added.

The planning checkout's ADR-007 file contains the size amendment but not the
referenced Amendment (2). The exact fake behavior in the user's Round 2 message
was used as authority, with no additional validator, JSON-LD or canonicalizer
dependency. Fake JSON-LD and blank-node canonicalization throw the exported typed
error; fake validation defaults to a conforming empty report and is injectable.

Both optional serialize and parseShaclCompact bindings are present in 0.1.5 and
are feature-detected at initialization. Compact SHACL parsing is reported as a
capability; the current validate string argument remains Turtle per ADR D2.
Remote JSON-LD context loading and ODRL remain unavailable in the pinned bundle.
A configured wasmUrl initializes the shipped web binding directly because the
published high-level init() accepts no URL. TriG base resolution uses n3 before
WASM loading because 0.1.5 has no dataset-preserving base loader. The README
records these limits and the fake/real contract split.

No other blocking question remains. No push, PR, branch switch, remote fetch or
merge occurred. STATUS.md was updated last; the final commit leaves the tree clean.
