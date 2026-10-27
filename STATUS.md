<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.18.1 lane report

Branch: `lane/sst-8xm.18.1`.
Base: `0d8842080a31b716b2d1350efed53b19eb8c6832`.
Implementation is complete. All four changed package gates pass. The affected and
full workspace gates were run before this final report commit and **failed outside
this lane's changed source**; their blockers are recorded below. Workspace-green
acceptance and automated review remain unfinished.

## Commits

- `d8db6fef` — `test: capture legacy IRI guard differentials`: capture old guard
  outputs before replacement; compare each copy with rdf-serialize across 96
  adversarial inputs; exercise contacts through typed public accessors; add the
  bridge workspace dependency and lockfile entry; document conservative choices.
- `09c15e64` — `fix: delegate package IRI guards to rdf-serialize`: replace the
  federation and drawing guards with re-exports, import the contacts escaper,
  delegate the bridge HTTP guard, and delegate the drawing subject guard while
  retaining its embedded-C0 restriction. Update the existing relationship test
  and key documentation for lexical RDF identity, including an explicit `:443`.
- Final commit — `docs: record IRI guard lane results`: this report, committed last.

Public export names remain available. Production HTTP/escape guard copies have
been removed from the targeted files; only shared imports and compatibility
pre-checks remain. Tests retain frozen old results rather than executable copies
of the old guards.

## Conservative compatibility choices

See [QUESTIONS.md](QUESTIONS.md) for options and the relevant brief sections.

- Legacy-bridge retains rejection of raw quotes/braces surviving URL parsing in
  hostnames and braces/backslashes surviving in queries or fragments. The shared
  helper would otherwise accept their escaped forms. A parsed-href pre-check
  preserves those rejections before delegation; existing percent-encoded forms
  remain accepted. Nine shared-only corpus acceptances remain rejected locally.
- Drawing's public subject guard retains rejection of embedded C0 controls before
  delegation. Shared lexical-authority restrictions also apply.
- `packages/rdf-serialize/SKILL.md` does not exist at the base. Its canonical IRI
  source and exports, the legacy-bridge package skill, and shared RDF/testing/review
  guidance were read instead. No new skill was invented.

No open question requires a maintainer answer to review the implementation.

## Dependency policy and installation

Commands used Node `v24.22.1` and pnpm `10.4.1`, with
`export PATH=/opt/node24/bin:$PATH`.

- `pnpm run check:packages @jeswr/rdf-serialize --mode policy` — **PASS**, one
  package cleared, before adding the dependency. This is an existing internal
  workspace package; no third-party dependency was added.
- Added `@jeswr/rdf-serialize: workspace:*` only to legacy-bridge; the other three
  packages already declared it.
- `pnpm install --offline` — failed trying to create a temporary directory in the
  sandbox-restricted global pnpm store while resolving unrelated dependencies.
  Added the corresponding workspace importer link to `pnpm-lock.yaml`, then ran
  `pnpm install --offline --frozen-lockfile` — **PASS**, lockfile up to date,
  resolution skipped, no downloads. Lifecycle scripts remained disabled.
- `pnpm run check:sdk-layers` — **PASS**, 99 manifests scanned.

Dependency-first preparation also passed:

```sh
pnpm exec turbo run build --filter='@jeswr/federation-registry^...' --filter='@jeswr/solid-drawing^...' --filter='@jeswr/solid-task-model^...' --filter='@jeswr/agentic-legacy-bridge^...' --concurrency=4
```

## Package gates

Each exact command below **passed** on the final implementation:

```sh
pnpm --filter @jeswr/federation-registry run lint && pnpm --filter @jeswr/federation-registry run build && pnpm --filter @jeswr/federation-registry run typecheck && pnpm --filter @jeswr/federation-registry run test
pnpm --filter @jeswr/solid-drawing run lint && pnpm --filter @jeswr/solid-drawing run build && pnpm --filter @jeswr/solid-drawing run typecheck && pnpm --filter @jeswr/solid-drawing run test
pnpm --filter @jeswr/solid-task-model run lint && pnpm --filter @jeswr/solid-task-model run build && pnpm --filter @jeswr/solid-task-model run typecheck && pnpm --filter @jeswr/solid-task-model run test
pnpm --filter @jeswr/agentic-legacy-bridge run lint && pnpm --filter @jeswr/agentic-legacy-bridge run build && pnpm --filter @jeswr/agentic-legacy-bridge run typecheck && pnpm --filter @jeswr/agentic-legacy-bridge run test
```

| Package | Test files | Tests |
| --- | ---: | ---: |
| federation-registry | 10 passed | 121 passed |
| solid-drawing | 4 passed | 90 passed |
| solid-task-model | 10 passed | 167 passed |
| agentic-legacy-bridge | 38 passed | 651 passed |
| Total | 62 passed | 1,029 passed |

The initial bridge package run exposed one obsolete canonical-href expectation in
`upgrade.test.ts`; it was updated to the shared lexical-identity contract, and the
entire bridge package gate was rerun successfully.

`pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage` — **PASS**, 651 tests;
statements 93.97%, branches 86.76%, functions 97.32%, lines 96.30%.

Before implementation, this command also passed all four differential files
(seven tests), verifying the captured results against the actual old copies:

```sh
pnpm --filter @jeswr/federation-registry --filter @jeswr/solid-drawing --filter @jeswr/solid-task-model --filter @jeswr/agentic-legacy-bridge exec vitest run iri-differential.test.ts
```

An initial glob-form Vitest filter matched no files; the filename filter above
corrected it. After migration, the package gates verify the shared behavior and
assert that every frozen old rejection stays rejected.

## Workspace gate results and blockers

- `pnpm run lint:root` — **PASS**, including the SDK layer guard.
- `TURBO_SCM_BASE=0d8842080a31b716b2d1350efed53b19eb8c6832 pnpm run gate` —
  **FAIL**, exit 1; Turbo reported 32 successful tasks / 49 started, four cached.
  The failing task was `@jeswr/app-issues#build`: Next.js could not fetch `Geist`
  and `Geist Mono` from Google Fonts. Root package-policy tests also reported
  diagnostic-output failures before the gate aborted.
- `pnpm run gate:full` — **FAIL**, exit 1; Turbo reported 77 successful tasks /
  234 started, 30 cached. The failing task was `//#test:root`: four files failed,
  166 tests failed and 734 passed (900 total). The files were
  `test/agent-layers-reachability.test.mjs`, `test/agent-layers.test.mjs`,
  `test/check-packages-guard.test.mjs`, and `test/check-sdk-layers.test.mjs`.
  Reported assertions expected rejection diagnostics but received empty stderr.
- Diagnostic command `pnpm run test:root -- test/check-packages-guard.test.mjs`
  ran the full root suite because of the argument separator; it independently
  failed in the same four files (163 failed / 737 passed). A direct `spawnSync`
  reproduction of a denylisted optional dependency returned the expected status
  1 with empty captured stdout and stderr. No cause beyond that observation is
  claimed. These tests, their guard implementations, and the Issues font-loading
  source are unchanged from the lane base.
- `roborev status` — unavailable, exit 127 (`roborev: command not found`);
  automated per-commit verdicts could not be obtained.

No font-loading source, root guard/test source, or review configuration was
changed to bypass these blockers. No source implementation remains unfinished;
workspace-green validation and roborev review remain blocked in this environment.

Logs are available locally under `/tmp/sst-8xm.18.1-*.log`, including the four
package gate logs, `affected-gate.log`, `full-gate.log`, and `policy-tests.log`.
No remotes were fetched, no branches switched, and nothing was pushed, published,
or opened as a PR. Built output remains ignored. The final commit contains only
this report, and the checkout is left clean.

## Fix round 2 — relationship migration review

Reviewed head: `70c3d3938333ad4004a7d99aae29dfd375117417`. Only the two
relationship migration findings were changed, with regression tests in the bridge
package and this report update.

- `215a8043` — `fix: restrict relationship fallback to legacy keys`: persist the
  counterparty key version, retain it through transitions and saves, and accept
  canonical fallback only for legacy records whose counterparty matches the old
  key. New lexical counterparties cannot inherit another relationship's verified
  identity or upgrade state. Tests retain legacy reopening and stale-ETag checks
  and cover separate lexical identities after a canonical relationship upgrades.
- `bc224a08` — `fix: preserve legacy pending offer retries`: independently version
  pending-offer normalization. Legacy retries use their original URL normalization
  for matching and send the persisted offer; new offers retain lexical protocol
  bindings. Tests cover trailing slashes, host case/default ports, dot segments,
  Unicode, escaping, reopening, transport failure/retry, and rejection of
  changed offers. Unsupported version metadata fails closed.
- Final report commit — `docs: record relationship migration fix results`.

Conservative compatibility choice: unversioned persisted documents are read as
legacy version 1; new relationship keys and new pending offers carry version 2.
Legacy metadata remains explicit after a save. Key and offer versions are
independent, so new offers on legacy relationships use lexical normalization.
No dependencies were added. No implementation work or maintainer question remains
for these findings; workspace-green validation and automated review remain blocked.

Commands used Node `v24.22.1` with `export PATH=/opt/node24/bin:$PATH`:

```sh
pnpm exec turbo run build --filter='@jeswr/agentic-legacy-bridge^...' --concurrency=4
pnpm --filter @jeswr/agentic-legacy-bridge run gate
pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage
TURBO_SCM_BASE=70c3d3938333ad4004a7d99aae29dfd375117417 pnpm run gate
timeout --kill-after=10s 300s pnpm run gate:full
```

- Dependency builds — **PASS**, six tasks.
- Bridge package gate — **PASS**, lint, build, typecheck, 38 test files / 677 tests.
  The first fix also passed its package gate before commit (670 tests).
- Coverage — **PASS**, 677 tests; statements 94.04%, branches 87.14%, functions
  97.33%, lines 96.37%.
- Affected workspace gate — **NOT PASSING**. Root lint (including the SDK layer
  guard) and the bridge tests passed. The unchanged
  `packages/personal-agent/src/actions/providers.test.ts` reported failures in
  `runs the operator's helper without a shell and maps its answers` and
  `settles once with a typed error when the helper exits early, hangs or floods`.
  The run then stopped producing output and was interrupted (exit 130).
- Full workspace gate — **FAIL**, exit 1, before the 300-second deadline; 60
  successful tasks / 222 total, 12 cached. Failing task: `//#test:root`, with four
  failed files, 162 failed / 738 passed tests. The unchanged files are
  `test/agent-layers-reachability.test.mjs`, `test/agent-layers.test.mjs`,
  `test/check-packages-guard.test.mjs`, and `test/check-sdk-layers.test.mjs`.
  Failures include empty captured subprocess diagnostics and a test timeout.
- `roborev status` — unavailable (`roborev: command not found`, exit 127).
  No automated verdicts could be obtained.

Workspace gates ran before the final report commit. No unrelated source or gate
configuration was changed. Logs: `/tmp/sst-8xm.18.1-round2-*.log` (not committed).
