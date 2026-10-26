<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-bk4r — HLT-00 lane report

Implemented on `lane/sst-bk4r`, based on `606c87b7edf73e83f118f95295b0eeda7abb6d92`.
Scope is `apps/suite/src/apps/health/lib/model/`, its tests, app dependency/test configuration,
and these lane documents. No UI, hooks, SDK facade, shell, project registrations or ontology changes.
No push, PR, branch switch, merge, or other checkout changes.

## Commits

- `2b192ca3 feat: port canonical health data model`: port Pod Health typed entities, GPX mapping,
  vocabulary normalization, safe Turtle serialization and existing model fixtures/tests.
- `ce5a12b9 feat: add health shards records and importers`: UTC month routing and daily/weekly
  aggregation; clinical records and scheduled reminders; streaming Apple XML measurements;
  GPX/index persistence and connector workout reads; injected-fetch, scoped, conditional I/O;
  explicit idempotent namespace migration; owner-private WAC container setup and retry checks.
- `eda5a615 test: enforce complete health model coverage`: the ordinary app test command enforces
  100% statements, branches, functions and lines for the complete model directory.
- `6bbb8e67 chore: limit lockfile changes to suite dependencies`: remove pnpm's unrelated peer
  snapshot churn, retaining only the app's required dependency declarations/resolutions.
- Final commit, `docs: record health lane validation`: this report.

## Validation

Commands run from this checkout. Where a workspace package has no local tool installation,
`export PATH="$PWD/node_modules/.bin:$PATH"` supplies the checkout's root toolchain.

| Exact command | Result |
| --- | --- |
| `pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @solid/object n3 @rdfjs/types @types/n3 @vitest/coverage-v8 saxes` | PASS: all 8 npm packages cleared before manifest changes. All versions already existed in the workspace lockfile. saxes supplies streaming XML parsing; the RDF libraries and coverage provider implement the brief's required surface/checks. |
| `pnpm install --ignore-scripts` | PASS after manifest changes; lifecycle scripts remained disabled. Existing unrelated peer/deprecation warnings only. |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS after removing unrelated lock snapshots; no resolution update required. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: Biome, Next production build, strict tsc, 119 tests in 10 files. |
| `pnpm --filter @jeswr/app-suite exec vitest run --coverage` | PASS: 624/624 statements, 277/277 branches, 193/193 functions, 560/560 lines. The ordinary `run test` now runs this coverage check too. |
| `pnpm run lint:root` | PASS, including lockfile/app/fetch guards, token check and all 74 contrast pairs. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | Final run PASS: 10/10 tasks; app build/typecheck/test and root lint/tests green. |
| `pnpm run gate:full` | BLOCKED outside this lane: `@jeswr/unstorage-solid#build` invokes `git clone https://github.com/jeswr/fetch-rdf.git` in its existing `scripts/build-deps.mjs`. Final attempt explicitly refused Git network operations (temporary ignored executable shim, removed afterwards); 29 tasks succeeded before failure. |
| `roborev status` | UNAVAILABLE: command not found (exit 127). No review verdicts available. |
| `git diff --check` | PASS. |

Workspace prerequisites were built using their existing build scripts: `@jeswr/guarded-fetch`,
`@jeswr/rdf-serialize`, `@jeswr/suite-vocab`, and `@jeswr/suite-ui`. No built outputs are committed.
An early standalone tsc attempt overlapped dependency rebuilding and saw temporarily absent
`guarded-fetch` declarations; the subsequent dependency-first gate and standalone tsc passed.

An initial affected-gate run selected unrelated packages due to pnpm's peer-snapshot churn and
entered the unstorage bootstrap. Initial full-gate attempts also entered that bootstrap and
failed on the read-only `/home/runner/.npm` cache. `GIT_ALLOW_PROTOCOL=file` was filtered by Turbo's
strict environment, so it did not prevent that dependency clone; the final attempt used an
executable shim to enforce the lane restriction. The bootstrap cleans its temporary clone.
No changes to the bootstrap, cache, external checkout, or dependency sources are retained.

Workspace dependencies added to the app are existing `workspace:*` members (`suite-vocab`,
`guarded-fetch`, `rdf-serialize`); no registry install/check applies to those local links.
The final lockfile diff changes only the app-suite importer.

## Coverage and interpretations

Tests cover canonical/legacy fixtures, migration idempotence and foreign-data preservation,
monthly boundaries, UTC daily/ISO-week reducers, clinical record/reminder round-trips, seven
Apple fixture observations, chunk backpressure and malformed XML, GPX route ordering/segments,
connector ExerciseAction reads, strong ETags/conflicts, private ACL setup/retry failures,
foreign listing rejection, redirect refusal, and the placeholder grep/model-layer import rules.

Conservative choices and options are recorded in `QUESTIONS.md`: retain existing canonical
Pod Health workout/route terms because sector classes do not exist; use UTC/Monday buckets;
limit the placeholder ban to the new health surface while retaining suite-vocab legacy aliases;
retain derived Apple observations only; require verifiable owner-private WAC ACLs and fail closed
when unavailable. No implementation question remains blocking this lane.

Screenshots/Playwright/axe: not applicable; this model-first lane renders no UI or routes.
No browser was launched. Hooks, Type Index wiring, offline behavior and UI remain assigned to
HLT-01 and later tasks by the model-first split; the model API is documented beside the code.
The only incomplete verification is the unrelated full gate and unavailable roborev review.

## Fix round 3 — review `c1e768b43ab0`

Addressed exactly the three findings in
`/home/runner/work/solid-suite-tracker/lanes/reviews/solid-sdk-lane-sst-bk4r-c1e768b43ab0.md`.
Resumed from `c1e768b43ab0736905338ad1dcd9e86a666fcf44` on `lane/sst-bk4r`.

### Commits

- `26a32d61 fix: reject external health JSON-LD contexts`: route resource, initialization ACL,
  and target ACL reads through one JSON-LD validation boundary before `fetchRdf` parses them.
  Refuse remote contexts/imports, including relative and same-pod URLs; retain inline contexts.
  Normalize validated JSON before parsing so duplicate keys cannot bypass validation.
  Regression tests cover nested/scoped/array contexts, imports, both ACL paths, no global fetch,
  inline context/ACL compatibility, ETag/relative identity preservation, and duplicate keys.
- `884a11f8 fix: preserve blank metric links as RDF terms`: observation code/time getters retain
  RDF terms; setters accept terms or IRI strings. Concept/instant resolvers accept terms.
  Regression tests cover all four named/blank code/time combinations, Turtle round trips,
  term assignment, direct LOINC links, and unchanged measurement values.
- `40ba25b7 fix: load established connector workout files`: merge native workout indexes with
  `health/workouts.ttl` (Apple Health) and `health/activities.ttl` (Garmin/Fitbit), or caller-supplied
  in-scope connector paths. Deduplicate document reads and workout identities; tolerate absent
  connector files while preserving permission/parse failures. Tests use the established root
  documents, missing native containers, custom locations, duplicate sources, and foreign paths.
- Final commit, `docs: record health fix round three validation`: this report, committed last.

### Validation

Commands ran in this checkout. The initial targeted I/O test could not resolve unbuilt
`suite-vocab` output; building the four existing workspace prerequisites resolved it.
The blank-node change's initial typecheck exposed wrapper/optional-term typing mismatches;
these were corrected in its final commit before the successful checks below.

| Exact command | Result |
| --- | --- |
| `PATH="$PWD/node_modules/.bin:$PATH" pnpm exec turbo run build --filter="@jeswr/app-suite^..." --concurrency=4` | PASS: guarded-fetch, rdf-serialize, suite-vocab, suite-ui. Generated output is ignored. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/health/io.test.ts` | PASS after the context fix: 62 tests. |
| `pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite exec vitest run test/health/metrics.test.ts test/health/model.test.ts` | PASS after the blank-node fix: strict tsc and 54 tests. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: Biome, production Next build, strict tsc, 185 tests in 10 files. Model coverage remains 100% statements (682/682), branches (343/343), functions (203/203), lines (608/608). |
| `pnpm run lint:root` | PASS: Biome, lockfile/app/fetch guards, tokens, 74 contrast pairs. |
| `PATH="$PWD/node_modules/.bin:$PATH" TURBO_SCM_BASE=e2f34bbc4af68bbde69a3e23401b4a1ce12d5ced pnpm run gate` | PASS: 9/9 Turbo tasks; root lint also passed. |
| `PATH="/tmp/sst-bk4r-fix3-bin:$PWD/node_modules/.bin:$PATH" pnpm run gate:full` | BLOCKED outside this lane: existing unstorage-solid dependency bootstrap tries `git clone https://github.com/jeswr/fetch-rdf.git`. A temporary Git shim refused network operations to honor the lane restrictions. Exit 1; 10 tasks succeeded before interruption. Shim removed afterwards. |
| `roborev status` | UNAVAILABLE: command not found (exit 127); no automated verdict available. The supplied review was read in full and addressed. |
| `git diff --check` | PASS. |

No dependencies, manifests, lockfiles, UI, vocabulary, other checkouts, or remote branches changed.
No package-policy checks or screenshots were needed. Conservative interpretation: reject every
remote JSON-LD context/import, including same-pod URLs, because the pinned parser has no injectable
loader. Caller-supplied connector paths replace the default connector locations while native
indexes are always retained. No implementation work remains unfinished and no open questions
remain; full-workspace validation and roborev availability are the verification limitations.
