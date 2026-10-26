<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-vuhh — CON-02 lane report

## Fix round 3 — 2026-10-26

Starting revision: `939b1e0028ccd457b5a08eb101f3a553454b92a6` on `lane/sst-vuhh`.
Only the collection-metadata finding in the supplied round 3 review was addressed.

- `56aaba0b` — `fix: preserve collection metadata in incremental imports`: merge adapter
  data before adding provenance, so only adapter-supplied subjects replace stored descriptions.
  Existing collection type/name survive item-only and empty merge pages; explicit collection
  descriptions still replace their old metadata. Six API/file regression cases also verify
  current document/item provenance, unchanged retained-item provenance, item counts and adapter
  input immutability. The item-only and empty cases reproduced metadata loss before the fix.
- Final `docs: record third connector fix results` commit — this report, committed last.

Validation commands on the final source revision:

```sh
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/pod-connectors^... run build
pnpm --filter @jeswr/pod-connectors exec vitest run src/core/incremental.test.ts
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
pnpm run lint:root
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=482fd9214b3876c5791ecdbb64f72286c69654e9 pnpm run gate --env-mode=loose
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
pnpm run test:root
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=482fd9214b3876c5791ecdbb64f72286c69654e9 pnpm run gate --env-mode=loose
git diff --check
```

- Workspace dependency build: exit 0. The fresh checkout initially lacked guarded-fetch's
  dist; building it enabled the regression run. Final targeted suite: **24 tests pass**.
- Package gate: exit 0; lint has the same **36 existing warnings**, build/typecheck pass,
  **44 files and 321 tests pass**. Root lint and all root guards: exit 0.
- Initial affected workspace gate: exit 1, **7 successful / 9 total tasks**. The unchanged
  `test/agent-layers.test.mjs:509` case for `module.require(TARGET);` exceeded its 5000 ms
  timeout; root tests were **685 passed, 1 failed**. Connector tests passed within the gate.
- Full workspace gate: exit 1, **18 successful / 60 total tasks** reported before aborting.
  The unchanged unstorage-solid dependency bootstrap attempted its remote fetch-rdf clone;
  `GIT_ALLOW_PROTOCOL=file`, inherited through `--env-mode=loose`, rejected it with
  `fatal: transport 'https' not allowed` before network access. No workaround was made.
- Standalone root suite: exit 0, **7 files and 686 tests pass**.
- Affected workspace gate retry: exit 1, **7 successful / 9 total tasks**, with 6 cached.
  The same unchanged root test group timed out for `export * from TARGET;`; again **685
  passed, 1 failed**. Pod Manager's remaining dependent checks were interrupted by the root
  failure. No unrelated tests, timeouts or build scripts were changed.
- `git diff --check`: passed. Full and affected workspace verification remain incomplete.

No dependencies, manifests or lockfile changed; `check:packages` is not applicable. Lifecycle
scripts were never enabled. Regression tests use memory Pods and synthetic fixtures. No remote
fetch/merge, push, PR, branch switch, publishing or changes to another checkout.
`roborev` is not installed; asynchronous review remains unavailable and was not reconfigured.

The requested fix is complete. No new open questions or unfinished implementation; verification
and review limitations are recorded above. Earlier reports below remain historical context.

---

## Fix round 2 — 2026-10-26

Starting revision: `482fd9214b3876c5791ecdbb64f72286c69654e9` on `lane/sst-vuhh`.
Only the two supplied review findings were addressed.

- `42780c8f` — `fix: retain registrations across repeated connector writes`: accumulate
  successful class/container requests independently from the document report, retaining every
  requested class while deduplicating registrations and reported URLs. API and file regression
  tests merge recordings and playlists into one document, repeat a class, then skip a companion
  registration; both classes remain discoverable and the document count stays one.
- `77ab46de` — `fix: match fixture routes by consistent specificity`: recording and replay
  share longest-prefix selection with the same origin and complete path boundaries. Tests cover
  both route configuration orders, ordinary-before-special recording, route-specific redaction,
  replay in a different order, method queues, exhaustion without broad-route fallback, and
  rejected sibling paths/origins. Package documentation describes the matching rule.
- Final `docs: record second connector fix results` commit — this round's lane report.

Validation on the final source revision:

```sh
pnpm --filter @jeswr/pod-connectors^... run build
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=482fd9214b3876c5791ecdbb64f72286c69654e9 pnpm run gate --env-mode=loose
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
```

- New regressions reproduced the findings before their fixes. The first incremental-test run
  could not resolve guarded-fetch's absent dist; building workspace dependencies resolved it.
- Workspace dependency build: exit 0.
- Package gate: exit 0; lint reports the same 36 existing warnings; build and typecheck pass;
  **44 files and 315 tests pass**.
- Affected workspace gate: exit 0, **10/10 tasks**. Root lint/guards pass; Pod Manager's
  build/typecheck/tests pass (**68 files, 930 passed, 1 skipped**).
- Full workspace gate: exit 1, **34/190 tasks** completed. The unchanged
  `packages/unstorage-solid/scripts/build-deps.mjs` requires a fetch-rdf network clone when its
  dist is absent. `GIT_ALLOW_PROTOCOL=file`, inherited through `--env-mode=loose`, blocked that
  operation with `fatal: transport 'https' not allowed` before network access. No workaround or
  unrelated source change was made. Root tests passed in that run (**7 files, 686 tests**).
  Full-workspace verification remains incomplete.
- `git diff --check`: passed.

No dependencies, manifests or lockfile changed; `check:packages` is not applicable. Lifecycle
scripts were never enabled. Tests use fixtures and memory Pods. No remote fetch/merge, push,
PR, branch switch, publishing or changes to another checkout. `roborev` is not installed, so
asynchronous review remains unavailable; it was not installed or reconfigured.

Both requested fixes are complete. No new open questions or unfinished implementation.
The conservative prefix rule preserves the recorder's existing origin/path boundaries and
applies longest-prefix specificity consistently to recording and replay. Verification and review
limitations are recorded above; earlier reports below remain historical context.

---

## Fix round 1 — 2026-10-26

Starting revision: `a102f825919ca24abf07a0633e2121b0044f8242` on `lane/sst-vuhh`.
Only the three supplied review findings were addressed.

- `aba2a4ec` — `fix: preserve connector items sharing identifiers`: merge by deterministic
  named subject, retaining distinct Amazon order lines with the same order identifier; count
  those subjects separately. Tests cover first import, re-import, and shared identifiers across
  incremental pages without mutating inputs.
- `243bbaea` — `fix: preserve connector snapshot replacement semantics`: add document
  `writeMode: 'replace' | 'merge'`. Conservatively restore replacement as the default for
  existing adapters; incremental pages opt into merge. Tests cover shrinking and empty Spotify
  and GitHub snapshots, explicit/default replacement after read-edit-write deletion, and the
  existing incremental/state/ETag behavior. Existing adapters that merge their read datasets
  continue to own those edits and deletions.
- `5c524f46` — `fix: replay repeated fixture routes in request order`: repeated normalized
  method/static-prefix keys replay in array order, then fail on exhaustion. Single-entry keys
  remain reusable for existing demo fixtures. The recorder preserves request order even when
  responses complete out of order. Tests cover different pages/statuses, independent method
  sequences, fresh replay cursors, redaction and static URLs without saving dynamic URLs.
- Final `docs: record connector review fix results` commit — this round's lane report.

Validation on the final source revision:

```sh
pnpm --filter @jeswr/pod-connectors^... run build
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=a102f825919ca24abf07a0633e2121b0044f8242 pnpm run gate
GIT_ALLOW_PROTOCOL=file pnpm run gate:full
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
pnpm run test:root
```

- Workspace dependency build: exit 0. The first targeted test attempt could not resolve
  guarded-fetch's absent dist in the fresh checkout; tests passed after this dependency build.
- Package gate: exit 0; lint has 36 existing warnings, build/typecheck pass,
  **44 test files and 310 tests pass**. Targeted regressions also passed before each fix commit.
- Affected workspace gate: exit 0, **10/10 tasks**. Root lint/guards pass; Pod Manager's
  build/typecheck/tests pass (**930 passed, 1 skipped**).
- First full workspace gate: interrupted (exit 130). Turbo's default strict environment
  filtered out `GIT_ALLOW_PROTOCOL`, so unstorage-solid's existing dependency bootstrap
  unexpectedly cloned its pinned fetch-rdf dependency from the network. The gate was stopped
  on discovering this lane-rule violation; the bootstrap had already finished and removed its
  temporary clone. This was an implementation-lane execution mistake, not an authorized fetch.
- Full workspace gate retry with explicit `--env-mode=loose`: exit 1, **60/231 tasks**
  completed. The unchanged root test `test/agent-layers.test.mjs:509`,
  `rejects disallowed path characters globally: require(TARGET);`, exceeded its existing
  5000 ms timeout under the full gate. Root results: **685 passed, 1 failed** across 7 files.
  No additional network clone occurred in this retry. Unrelated files/timeouts were not changed.
- Standalone root test suite: exit 0; **7 files and 686 tests pass**. The full-gate
  timeout did not reproduce in the standalone run. Full-workspace verification remains incomplete.
- `git diff --check`: passed.

The full-gate retry explicitly uses `--env-mode=loose` so child tasks inherit
`GIT_ALLOW_PROTOCOL=file`, restricting Git to local transports. The initial full-gate mistake
above is disclosed rather than claiming that no network clone occurred.
No dependency, manifest or lockfile changed; `check:packages` is not applicable. Lifecycle
scripts were never enabled. Tests use fixtures and memory Pods, with no real accounts or
production API calls. `roborev` is not installed, so asynchronous review remains unavailable;
it was not installed or reconfigured. No pushes, PRs, branch switches, merges or publishing.

All three requested fixes are implemented. No new open questions or unfinished implementation.
Full-workspace verification and review limitations are recorded above. The original round's
report below is retained as historical context.

---

Branch: `lane/sst-vuhh`.
Base: `752a62440676306177bc6dac88d3e0cee069e2fb`.
Environment: Node `v24.22.1`, pnpm `10.4.1`.

## Commits

- `9d48e10e` — `feat: add connector state and incremental provenance`: host-owned ConnectorState, automatic conditional merge by deterministic slug and item subject/identifier, failure checkpoint preservation, one PROV activity per run, typed item/document derivation, and every adapter's vocabulary seam. Includes framework, two-adapter idempotency and provenance tests, plus QUESTIONS.md.
- `7ea04f81` — `feat: add redacting connector fixture recorder`: injected recorder with public static routes, fail-closed scalar-path allowlists, mandatory sensitive-key removal, detached host-saveable snapshots, redaction/replay tests and package documentation.
- `64fac944` — `fix: guard connector provenance and recorder aliases`: reject reserved provenance document aliases and blanket recorder wildcards; add regression tests.
- `cddc524d` — `test: cover connector checkpoints and source provenance`: test no-ETag servers and first-run failures; make collection derivation include individual source-item URLs as well as the source fallback.
- `dde689f5` — `fix: preserve recorded source request bodies`: avoid transferring Request body streams in the recorder; test POST bodies and RequestInit overrides.
- Final `docs: record CON-02 lane results` commit — this STATUS.md, committed last.

## Validation

The final source revision passed this exact package gate (exit 0):

```sh
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
```

- Lint: exit 0; 36 warnings in existing tests/code, no errors. New framework modules were checked separately without diagnostics.
- Build and typecheck: exit 0.
- Test: **44 files, 302 tests passed**. Source transports are fixture/mocked and Pod writes use memory Pods; no real accounts or production API traffic in tests.

These exact workspace commands passed (exit 0):

```sh
pnpm run lint:root
TURBO_SCM_BASE=752a62440676306177bc6dac88d3e0cee069e2fb pnpm run gate
```

The final affected gate completed **11/11 tasks**, including Pod Manager build/typecheck and its **930 passed, 1 skipped** tests, plus root tests and guards. `git diff --check` passed.

The session-close full-workspace command was attempted:

```sh
pnpm run gate:full
```

Result: **exit 1**, `@jeswr/unstorage-solid#build` failed in its existing fetch-rdf dependency bootstrap. npm could not write `/home/runner/.npm/_cacache/tmp` (`EROFS`, read-only filesystem). The existing build script had cloned its pinned dependency into a temporary `/tmp/fetch-rdf-build-*` directory before npm failed; its finally block removes that directory. No workaround, bootstrap change, manual remote fetch/merge, or further retry was made. Full-workspace verification is incomplete.

Additional coverage audit:

```sh
CI=true pnpm --filter @jeswr/pod-connectors exec vitest run --coverage
```

Result: all **302 tests passed**, but command **exit 1** because global branch coverage is **74.16% (1019/1374)** against the existing 100% threshold. Core overall is below the DESIGN §3 target as well; this lane does not claim package-wide 100% coverage. The new modules have **100% branch coverage**: fixture-recorder `37/37`, import-session `42/42`, incremental `16/16`, shared vocab-map `2/2`; federation constants and PROV accessors have no branches. Existing adapters, OAuth and helper coverage account for the remaining gap. Thresholds and test configuration were not weakened.

## Dependencies and review

- No dependencies or manifests changed; lockfile unchanged. `pnpm run check:packages <name>`: **not applicable**, because no dependency was added. Lifecycle scripts were never enabled.
- `command -v roborev` returned no executable. The mandated asynchronous reviews/verdicts could not be obtained; roborev was not installed or reconfigured.
- No pushes, PRs, publishing, branch switches or merges were performed.

## Conservative interpretations and remaining questions

See [QUESTIONS.md](QUESTIONS.md) for the numbered choices and spec references. In particular, solid-federation-vocab has no JavaScript API, so exact ontology term IRIs are isolated locally rather than changing that package or switching early to suite-vocab. The actual scheduling term is `CalendarEvent`. Every adapter has a mapping seam; detailed per-adapter field mapping remains with the already specified follow-on connector tasks.

Host persistence, source-specific deletions, CLI state-file permissions and later adapter expansion remain outside CON-02. The host must explicitly designate non-personal recorder fields; values needed for personal-field fixtures must be synthetic. No source-item URL is invented where an export lacks one: an explicit document URL or source/export IRI provides the fallback.

The three CON-02 acceptance checks are implemented and passing. Outstanding verification is full-workspace gate completion, repository-wide coverage improvement toward DESIGN §3, and the unavailable roborev review. Maintainer confirmation of the temporary vocabulary-constants bridge remains an open question; implementation followed the conservative option documented in QUESTIONS.md.
