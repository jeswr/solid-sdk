<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# sst-618 / VOC-03 lane report

Branch: `lane/sst-618`. Base: `74e0ed4ffc60b1002fccb916cac85db867da0127`.

## Commits

- `d25db086` — `feat: add canonical suite vocabulary constants`: private ESM package,
  namespace aliases/comparison helpers, package skill, workspace dependencies/lock and inventory.
- `ab1b46eb` — `feat: canonicalize health vocabulary reads and writes`: canonical Health/Core/
  workout constants, typed in-memory normalization preserving identities, literals and graphs,
  canonical explicit registration and dual-IRI discovery, legacy fixtures and README note.
- `53886ab1` — `feat: remint drive vocabulary with legacy discovery`: canonical DriveRoot marker,
  registration and serializer prefixes, dual-IRI discovery, ontology and fixtures.
- `a250748c` — `feat: remint docs vocabulary and preserve legacy reads`: ontology with exactly
  seven approved terms, container-link constants, legacy bodies/revisions, canonical-first
  predicate reads and canonical Type Index registration alongside existing legacy entries.
- `141d069` — `feat: complete shared namespace inventory`: include existing trust, memory,
  credentials, delegation and Access Manager namespace bases and remaining standard bases.
- `9cf805f4` — `fix: reject named graphs in health Turtle writes`: reject TriG graphs on
  the Turtle save path; validate default-graph serialization with a Turtle parser.
- `96aa4bda` — `fix: wire canonical vocab into app metadata and hosts`: canonical public
  JSON-LD metadata, canonical inline Docs federation context, three nested web dependency
  links and Vite aliases, and metadata regression checks.
- `d0dbdf68` — `fix: ignore non-IRI types in alias-aware readers`: typed term accessors
  ignore malformed literal types while recognizing valid canonical/legacy classes.
- Final documentation commit records this status; see `git log` for its hash.

## Validation

All commands run inside this checkout. The shell initially exposed only a relative
`node_modules/.bin`, so validation exported `PATH="$PWD/node_modules/.bin:$PATH"` at the
workspace root. No source/tool configuration was changed for that environment issue.

Latest individual package results (each lint, build, typecheck and test passed):

| Package | Tests | Coverage: statements / branches / functions / lines |
|---|---:|---|
| `@jeswr/suite-vocab` | 46 | 100 / 100 / 100 / 100 |
| `@jeswr/app-pod-docs` | 168 | 100 / 98.67 / 100 / 100 |
| `@jeswr/app-pod-drive` | 94 | 100 / 100 / 100 / 100 |
| `@jeswr/app-pod-health` | 124 | 100 / 99 / 100 / 100 |

Exact per-project commands (all executed):

```sh
pnpm --filter @jeswr/suite-vocab run lint
pnpm --filter @jeswr/suite-vocab run build
pnpm --filter @jeswr/suite-vocab run typecheck
pnpm --filter @jeswr/suite-vocab run test
pnpm --filter @jeswr/suite-vocab exec vitest run --coverage
pnpm --filter @jeswr/app-pod-docs run lint
pnpm --filter @jeswr/app-pod-docs run build
pnpm --filter @jeswr/app-pod-docs run typecheck
pnpm --filter @jeswr/app-pod-docs run test
pnpm --filter @jeswr/app-pod-docs run coverage
pnpm --filter @jeswr/app-pod-drive run lint
pnpm --filter @jeswr/app-pod-drive run build
pnpm --filter @jeswr/app-pod-drive run typecheck
pnpm --filter @jeswr/app-pod-drive run test
pnpm --filter @jeswr/app-pod-health run lint
pnpm --filter @jeswr/app-pod-health run build
pnpm --filter @jeswr/app-pod-health run typecheck
pnpm --filter @jeswr/app-pod-health run test
pnpm --filter @jeswr/app-pod-health run coverage
```

The Docs suite includes N3 parse/declaration checks for both Turtle files and a source-tree
legacy-literal guard across all three apps. Dedicated fixtures exercise canonical and legacy
classes, predicates, revision history, Type Index locations, and canonical subsequent writes.
The Health tests also verify preservation of literal contents and named graphs.

Nested web-host checks:

- All three `lint`, production `build`, and `typecheck` commands passed after restoring the
  workspace dependency closure. Docs and Drive were built again after the final class-filter
  refinement; logs `/private/tmp/sst-618-web-{docs,drive}-build-final.log`.
- `@jeswr/pod-docs-web`: 136/136 tests PASS.
- `@jeswr/pod-drive-web`: 172/173 tests PASS; unchanged
  `src/auth/restore-latch.test.tsx` runtime-initialization rejection test timed out at 15 seconds.
- `@jeswr/pod-health-web`: 179/181 tests PASS; both unchanged
  `src/App.extension.test.tsx` cases timed out at 5 seconds.
- Lower-concurrency retries reproduced the same Drive/Health timeouts and were stopped after
  reproducing them. No authentication/UI implementation or timeout settings were changed.
- Test logs: `/private/tmp/sst-618-web-docs-test.log`,
  `/private/tmp/sst-618-web-drive-test.log`, `/private/tmp/sst-618-web-health-test.log`.

Exact web commands executed (the `&&` chains stopped on the reported test failures):

```sh
pnpm --filter @jeswr/pod-docs-web run lint && pnpm --filter @jeswr/pod-docs-web run build && pnpm --filter @jeswr/pod-docs-web run typecheck && pnpm --filter @jeswr/pod-docs-web run test
pnpm --filter @jeswr/pod-drive-web run lint && pnpm --filter @jeswr/pod-drive-web run build && pnpm --filter @jeswr/pod-drive-web run typecheck && pnpm --filter @jeswr/pod-drive-web run test
pnpm --filter @jeswr/pod-health-web run lint && pnpm --filter @jeswr/pod-health-web run build && pnpm --filter @jeswr/pod-health-web run typecheck && pnpm --filter @jeswr/pod-health-web run test
pnpm --filter @jeswr/pod-drive-web run test --maxWorkers=1
pnpm --filter @jeswr/pod-health-web run test --maxWorkers=1
```

Root commands:

- `pnpm run lint:root` — PASS (Biome, lockfile transport, app workspace, raw-fetch guard).
- `TURBO_SCM_BASE=74e0ed4ffc60b1002fccb916cac85db867da0127 pnpm run gate` — initial attempt
  FAIL: four unchanged root `test/check-packages-guard.test.mjs` tests timed out at 5 seconds.
  All 22 other root tests passed. Log: `/private/tmp/sst-618-gate.log`.
- `pnpm run gate:full` — FAIL: `@jeswr/unstorage-solid` build cannot resolve its installed
  `esbuild` dependency (`node_modules` missing there). This unrelated package was not changed;
  the broad workspace dependency restore did not finish. Log: `/private/tmp/sst-618-gate-full.log`.
- `pnpm exec vitest run test/check-packages-guard.test.mjs --testTimeout 60000` — PASS,
  4/4 tests; diagnostic only, no test timeout/configuration changes committed. Log:
  `/private/tmp/sst-618-root-policy-diagnostic.log`.
- First affected-gate retry — FAIL: root policy tests passed, but an unchanged mirror
  publisher test's `afterEach` exceeded its 10-second timeout (25/26 root tests passed).
  Log: `/private/tmp/sst-618-gate-retry.log`.
- Affected gate after the web dependency links — FAIL: `app-shell` build cannot find its
  installed React/Radix dependencies (its `node_modules` was absent). Log:
  `/private/tmp/sst-618-gate-final.log`.
- Earlier `pnpm run gate:full` retry — FAIL: Pod Manager build cannot find `next`;
  its `node_modules` is absent. Log: `/private/tmp/sst-618-gate-full-final.log`.

- Latest required affected gate (same `TURBO_SCM_BASE` and command above), after the final
  reader refinement — FAIL: unchanged cleanup hooks in `test/check-packages-guard.test.mjs`
  and `test/mirror-publish.test.mjs` exceeded 10 seconds (24/26 root tests passed);
  19 Turbo tasks succeeded before cancellation. Log: `/private/tmp/sst-618-gate-last.log`.
- `pnpm exec turbo run test:root --filter=//` — FAIL in the unchanged mirror-publish cleanup
  hook (25/26 tests passed). Log: `/private/tmp/sst-618-root-tests-isolated.log`.
- Latest required `pnpm run gate:full`, after the final reader refinement — FAIL:
  `@jeswr/app-pod-chat` cannot find `tsup` because its `node_modules` is absent. Other
  workspace packages also remain uninstalled; the lane's package/app dependency closure
  is installed. Log: `/private/tmp/sst-618-gate-full-last.log`.

Dependency setup:

- `CI=true pnpm install --frozen-lockfile --lockfile-only --offline` — PASS.
- `CI=true pnpm install --frozen-lockfile --prefer-offline --cache-dir=/private/tmp/sst-618-pnpm-cache --store-dir=/private/tmp/sst-618-pnpm-store --filter @jeswr/suite-vocab --filter @jeswr/app-pod-docs --filter @jeswr/app-pod-drive --filter @jeswr/app-pod-health` — PASS.
- Broad workspace dependency restore was stopped after slow progress to remove contention
  during repository gates. Lifecycle scripts remained disabled throughout.
- No third-party dependencies were added; `check:packages` is not applicable. The only added
  dependency is the new `workspace:*` package in the three requested app manifests and their
  three nested web-host manifests.
- `CI=true pnpm install --frozen-lockfile --prefer-offline --cache-dir=/private/tmp/sst-618-pnpm-cache --store-dir=/private/tmp/sst-618-pnpm-store --filter @jeswr/pod-docs-web --filter @jeswr/pod-drive-web --filter @jeswr/pod-health-web` — PASS.
- `CI=true pnpm install --frozen-lockfile --prefer-offline --cache-dir=/private/tmp/sst-618-pnpm-cache --store-dir=/private/tmp/sst-618-pnpm-store --filter '@jeswr/pod-docs-web...' --filter '@jeswr/pod-drive-web...' --filter '@jeswr/pod-health-web...'` — PASS, including their workspace dependency closure.
- Lockfile changes are limited to six workspace links and the empty new importer.

## Review and scope

`roborev` jobs 5787 (`d25db086`), 5792 (`141d069`) and 5798 (`9cf805f4`) found no issues.
Read and addressed the substantive findings from Drive (5789), Health (5790), and Docs (5791):
canonical public metadata, explicit nested-web dependencies/aliases, and valid Turtle writes.
The ontology-publication findings are outside VOC-03: DECISIONS V12 and VOC-05 explicitly own
portfolio namespace-route deployment, with URLs pointing at these committed source Turtle files.
This lane forbids other-checkout edits and publication; no duplicate app-host namespace route
was introduced. Review 5799 requested adding federation fields to the existing OIDC-only web
metadata generators. This adds deployment behavior absent before this lane and is outside the
VOC-03 description/acceptance criteria; retained their existing shape and documented the
conservative reading in `QUESTIONS.md` (no generator emits legacy suite IRIs).
Review 5805 for the final class-filter refinement found no issues.
Some daemon enqueue requests timed out and were retried; no reviewer configuration changed.

No UI changes or screenshots. No pushes, git fetches, PRs, branch switches, mirror publishes,
other-checkout edits, or changes to `packages/solid-federation-vocab`.

Conservative readings and open questions are recorded in `QUESTIONS.md`: omit
`./testing` fakes from a pure constants package; canonicalize the existing `ph:` namespace;
retain explicit Drive/Health registration I/O boundaries; keep OIDC-only generator behavior.
HLT-01's persisted batch migration and VOC-02/VOC-04/VOC-05 remain outside this lane.

Generated local `web/public/clientid.jsonld` and `callback.html` files created during validation
were removed before the final commit; build output remains ignored. The final tracked changes
are limited to the requested package/apps, workspace metadata/lockfile, and the two lane reports.

Validation remains blocked at the repository gate and the two noted web UI suites; no blocking
namespace-design question remains beyond the conservative scope choices above.
