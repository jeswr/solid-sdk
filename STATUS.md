<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-8xm.60 / T-072 status

Date: 2026-10-26. Branch: `lane/sst-8xm.60`.
Original base: `302faf455f37e31ba6855975ad8dc34eb7ad06d0`.

Implemented T-072 using ADR-007's Amendment 2026-10-26 (2). Deleted the answered
QUESTIONS.md. solid-odrl remains authoritative; no WASM policy adapter is enabled.
No changes were made to fetch-rdf's default parser or to T-071's LocalIndex scope.

## Commits

- `fe3e83e9 feat(rdf-engine): add policy evaluation and form derivation`:
  add the workspace solid-odrl delegate, D2 context/result types, matched rule and
  active unfulfilled duty IDs, anonymous document-order naming, versioned Sparq
  policy capability detection, native FormDescription passthrough with store
  cleanup, and fake-engine behavior. Add corpus/projection/form/probe tests and
  package documentation. Remove QUESTIONS.md.
- `813e01f0 test(rdf-engine): record parse benchmark and crossover`:
  add bench/parse.bench.ts and bench:parse, commit bench/parse.json with machine
  information and all samples, and document the measured crossover in README.
- `docs: record T-072 implementation status` (this last commit): replace the
  previous blocked report with completed work, validation and handoff limits.

The earlier `f773e9ac docs: record T-072 policy contract questions` is retained in
history; its questions are answered by the amendment and its report is superseded.

## Gate results

Final commands ran before this last commit, with Node v24.22.1 and pnpm 10.4.1;
dependency lifecycle scripts remained disabled.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run lint build typecheck test --filter ...@jeswr/rdf-engine --concurrency=4` | PASS: 7 tasks successful, including the root lint dependency and dependency-first builds |
| `pnpm run lint:root` | PASS: Biome and all constituent guards, including 74 contrast pairs |
| `pnpm --filter @jeswr/rdf-engine run bench:parse` | PASS: all three exact-size fixtures parsed by both implementations; result quad counts asserted |
| `git diff --check` | PASS |

Turbo's dependant selector includes rdf-engine and every workspace dependant;
there are currently no other workspace dependants of rdf-engine. Its build also
built solid-odrl and rdf-serialize. The package test run passed **123 tests in
8 files**. Coverage: statements **98.93%**, branches **97.27%**, functions **100%**,
lines **99.60%**, exceeding the existing 90% thresholds. No whole-workspace gate
was run, following the brief's scoped gate requirement.

The shared policy tests exercise the 14 base solid-odrl characterization cases
representable by D2, comparing decisions directly with solid-odrl. The remaining
three cases require strict-duty options or arbitrary request attributes absent
from D2; no additional facade inputs were invented. Additional checks cover named
and anonymous trace IDs, inactive duties, injected time, missing/wrong purpose,
unknown actions, duplicate graph references, malformed rules/duties, unchanged
blank-node semantics and disposal. Probe tests cover absent/invalid/versioned
markers and prove the experimental export is never invoked. Form tests exercise
the real native response, edit/view options, explicit/automatic shape selection,
missing capability, native/JSON failures and temporary-store release.

## Parse measurements

Node v24.22.1, Linux x64, Intel Xeon Platinum 8488C; n3 2.0.3 / Sparq 0.1.5.
Each path produces a materialized RDF/JS dataset. Timings exclude fixture creation,
disk I/O and result-size assertions; the Sparq path includes query/JSON extraction,
RDF/JS materialization and freeing its native store. Three warmups per parser;
alternating-order sampling (21 per parser at small sizes, 7 at 10 MiB).

| Turtle size | Quads | n3 median | Sparq facade median |
| --- | ---: | ---: | ---: |
| 1 KiB | 42 | 0.192 ms | 0.348 ms |
| 100 KiB | 3,988 | 14.859 ms | 16.475 ms |
| 10 MiB | 366,746 | 1337.110 ms | 1449.040 ms |

No crossover was observed at the measured sizes through 10 MiB. In particular,
Sparq did not win at <= 100 KiB, so ADR-007 D1's default-flip condition is unmet:
n3 remains the default. Fresh-process lazy Node WASM import/initialization was
10.299 ms, reported separately; browser download and application imports are
excluded. Machine details, fixture hashes and individual samples are committed
in packages/rdf-engine/bench/parse.json. These synthetic local measurements do
not establish a universal crossover threshold. Biome formatted the committed
JSON; bench:parse also formats regenerated results.

## Dependency and environment notes

Only the brief-required `@jeswr/solid-odrl: workspace:*` dependency was added.
The lockfile change is limited to that workspace edge. Before adding it,
`pnpm run check:packages @jeswr/solid-odrl` ran and returned exit 1 because the
npm-only checker cannot find this unpublished first-party workspace package.
The brief explicitly requires this existing workspace dependency; no third-party
dependency was added.

An offline lockfile-only install could not resolve unrelated cached metadata.
A prefer-offline lockfile resolution introduced unrelated moving-pin/metadata
changes; those changes were discarded. The final lockfile contains only the
required workspace link. `pnpm install --offline --frozen-lockfile --ignore-scripts
--filter @jeswr/rdf-engine...` then passed without resolution or lifecycle scripts.

The installed git-pinned fetch-rdf dependency of solid-odrl had no dist or source.
Its build-deps script would clone from a network remote. To avoid that operation,
validation used the dist from the already installed npm fetch-rdf 0.1.0 artifact,
copied into the missing ignored node_modules location, plus an ignored symlink
from solid-odrl's node_modules to the already installed @rdfjs/dataset dependency
needed by that artifact. No tracked dependency pin or upstream package changed.
This validates the lane against that local artifact workaround; reproducing the
solid-odrl build from its exact git-pinned fetch-rdf source remains an environment
limitation. The policy delegate itself uses solid-odrl's workspace source build
and its dataset projection/evaluator, not fetch-rdf parsing.

## Handoff limits and open questions

- The requested `git merge --no-edit origin/main` ran first after initial
  inspection and reported `Already up to date.` The local origin/main is
  `917d3be9c7967622829adc43c1aaabb0964ec993`, an ancestor already in this lane;
  it does not contain T-071's query/snapshot/persistence/LRU implementation.
  No remotes were fetched and no T-071 work was implemented. Integration with
  the actual merged T-071 remains for the integrator when that code is available.
- `roborev` is unavailable on PATH, so automated per-commit review could not run.
  No tools or hooks were installed. Final diff inspection and scoped gates passed.
- Conservative API choices are documented: preserve solid-odrl's first recognized
  policy selection; number anonymous references using one-based dataset iteration
  order (including named reference positions); keep form derivation explicitly
  unsupported in the WASM-free fake. No design answer is outstanding for T-072.

All requested T-072 implementation is complete. No pushes, PRs, branch switches,
network git fetches/merges, or writes to other checkouts were performed. Only this
checkout and temporary command logs under /tmp were written.
