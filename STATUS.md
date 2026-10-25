<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-ito — A-002 agent history imports

Updated: 2026-10-25. Branch: `lane/sst-ito`; base: `agent/integration` at `61048c43`.
Implementation is committed. **A-002 acceptance is not complete:** personal-agent verification
remains timeout-blocked, and both repository gates fail on an existing Google Fonts build fetch.
This report is committed last, after the gate attempts.

## Commits

| Commit | Change |
| --- | --- |
| `783a6730` | Import personal-agent history from pilot head `d409005`; filtered parent `0edb2e6b679827939a9ea1183e35c935d991e7ff`. |
| `9a99b8a4` | Import legacy-bridge history from main head `82bea82`; filtered parent `aabd11fb06058b16cd50100cd3b426a73a987688`. |
| `bccc018e` | Delete imported dist, npm locks, standalone tool configuration, and check-dist scripts. |
| `5fccd959` | Integrate workspace dependencies, tooling, package skills, coverage, mirror configuration, and mechanical lint/declaration fixes. |
| This commit (`docs: record sst-ito validation blockers`) | Record validation results and remaining work. |

Both sources were cloned with `--no-local` into temporary directories, rewritten with
`git filter-repo --force --to-subdirectory-filter packages/<name>`, and merged separately
with `--allow-unrelated-histories`. Source checkouts were not edited. Only local temporary
repositories were fetched for the imports; no push, PR, or mirror-publish command ran.

## Scope and conservative choices

- Both packages retain their existing scoped names, exports, CLI entry points, source, docs,
  scripts other than check-dist, README, LICENSE, and existing handoff material.
- Internal git dependency specifications become `workspace:*`, including legacy-bridge's
  solid-chat-interop dependency. fetch-rdf remains `^0.1.0` because it is absent from this base.
- Both packages use Node `>=24`, root Biome/TypeScript settings, and Vitest 4.1.10 (root lock).
  personal-agent declares its already-used `@rdfjs/types` development dependency for pnpm.
- Mechanical source changes remove an unused import, make existing optional-chain assertions
  lintable, and annotate `evidenceGraph` with public N3 types to avoid a private declaration path.
- `src/triage/typesafe.ts` stays until A-011, following the dispatcher's later explicit instruction.
  Vocabulary migration and feature extraction belong to subsequent tasks.
- suite.json lists both packages. Each manifest declares `mirrorPublish.inlined: []` because
  tsc preserves dependency imports. Root tests verify target identity and refusal without
  every required dependency mirror SHA. Publishing remains unexecuted.
- Workspace guarded-fetch resolved undici **8.5.0**, so the pilot override is preserved as
  root `pnpm.overrides["@jeswr/guarded-fetch>undici"] = "8.9.0"`. Both workspace and existing
  guarded-fetch snapshot edges resolve the patched release in the lockfile.

## Dependency policy

All checks used the repository guard in strict full registry mode and passed:

```sh
pnpm run check:packages @a2a-js/sdk @modelcontextprotocol/sdk canonicalize express jose jsonld-streaming-parser @types/express @anthropic-ai/claude-agent-sdk @jeswr/fetch-rdf @solid/object n3 zod @biomejs/biome @types/n3 @types/node typescript vitest @rdfjs/types rdf-canonize @vitest/coverage-v8 undici --strict
pnpm run check:packages @anthropic-ai/sdk --strict
```

The seven specifically requested pilot dependency checks all passed. No policy exceptions or
new production APIs were introduced. The Anthropic SDK peer stays at the pilot lock's
`0.110.0`; a newer automatically selected peer archive stalled during temporary installation.

## Verification environment and dependency setup

Host: Node `v25.1.0`, pnpm `10.4.1`, TypeScript `6.0.3`, Vitest `4.1.10`.
Tests use existing injected transports, in-memory stores, fixtures, and loopback servers.
Verification uses a temporary `NODE_OPTIONS` preload blocking external TCP/DNS and remote git;
`GIT_ALLOW_PROTOCOL=file` also blocks remote git. No real credential store, provider API,
model API, Solid pod, provisioning command, or send script was used.

A pre-existing dependency build started a GitHub clone to reconstruct fetch-rdf before the
child-process block was added. It was interrupted. The existing lockfile-pinned fetch-rdf
source (`a8359a3`) was then compiled locally into ignored dependency output. No tracked
dependency package source was changed for that bootstrap; reconstructed output is ignored.

Normal workspace re-resolution was blocked by pre-existing `#main` git dependencies requesting
GitHub (notably federation-client/fetch-rdf). Registry dependencies were installed with
lifecycle scripts disabled in `/tmp/sst-ito-verification`, preserving pilot direct versions
and root tooling versions. Optional native components were omitted locally; provider SDKs
were not invoked. Dependencies were linked into ignored node_modules for verification.
The registry resolution was merged with unchanged existing lockfile entries and workspace
links. This consistency check passed:

```sh
CI=true GIT_ALLOW_PROTOCOL=file NODE_OPTIONS=--require=/tmp/sst-ito-offline.cjs pnpm install --ignore-scripts --frozen-lockfile --offline --lockfile-only
```

## Package checks and coverage

All commands below use `GIT_ALLOW_PROTOCOL=file NODE_OPTIONS=--require=/tmp/sst-ito-offline.cjs`.
For each package, `pnpm --filter <name> run lint`, `run build`, and `run typecheck` passed.
Dependency-first Turbo build passed for all seven required existing workspace dependencies.
No test or enforcement timeout was raised in configuration.

| Package/check | Result |
| --- | --- |
| legacy-bridge `run test --testTimeout=60000 --hookTimeout=60000` | PASS: 650 tests, 37 files. |
| legacy-bridge `run test:coverage --testTimeout=60000 --hookTimeout=60000` | PASS: 650 tests, 37 files. |
| personal-agent `run test --testTimeout=120000 --hookTimeout=120000` | Interrupted (exit 130) after at least 12 observed failures in helper startup, A2A, industrial, and health cases; no complete pass count. |
| personal-agent focused rerun | Two failures: fake SPARQ child probe ETIMEDOUT; a helper containing only `process.exit(0)` exceeded the unchanged 10-second helper deadline. |
| personal-agent sequential coverage run | FAIL: 82 passed, one failed; stopped by `--bail=1` at the A2A scheduling test's existing 20,000 ms limit. Three files passed, one failed, 53 files discovered. Remaining files were not verified. |
| personal-agent undici compatibility regression | PASS: four tests; verifies actual undici 8.9.0 loading, loopback transport, default refusal, and redirect revalidation. |

Focused command:

```sh
pnpm --filter @jeswr/personal-agent run test src/pilot/a2a.test.ts src/actions/providers.test.ts --testNamePattern='pinned policy binary was replaced|settles once with a typed error' --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1 --reporter=verbose
```

Undici compatibility command:

```sh
pnpm --filter @jeswr/personal-agent run test src/guarded-fetch-undici.test.ts --testTimeout=60000 --hookTimeout=60000 --maxWorkers=1 --reporter=verbose
```

Final sequential coverage command:

```sh
pnpm --filter @jeswr/personal-agent run test:coverage --coverage.reportOnFailure --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1 --bail=1 --reporter=verbose
```

Coverage includes all non-test TypeScript under each package's src directory:

| Package | Statements | Branches | Functions | Lines | SEC decision |
| --- | --- | --- | --- | --- | --- |
| agentic-legacy-bridge | 93.95% | 86.75% | 97.32% | 96.30% | Leave unset: below 100%. |
| personal-agent (partial, fail-fast run) | 30.64% | 23.89% | 30.59% | 31.65% | Leave unset: 100% not established. |

The personal-agent figures are **partial execution coverage, not a full-suite baseline**.
The first A2A scheduling test at `src/pilot/a2a.test.ts:267` hit its explicit 20-second timeout,
which the command-line default timeout does not override. The fake SPARQ child deadline
remains five seconds, and the credential helper deadline remains ten seconds. No enforcement
budget or embedded test timeout was changed. A separate trivial Node launch measured 2,824 ms
cold and 466 ms with the verification preload on a subsequent launch; startup latency varied.

## Root checks and repository gates

- `pnpm run lint:root`: PASS, including check:app-workspace, lockfile transport, and raw-fetch guards.
- `pnpm run test:root --testTimeout=60000 --hookTimeout=60000 --maxWorkers=2`: PASS, 28 tests.
  An earlier run hit two 10-second cleanup-hook timeouts; the retry passed without source changes.
- Affected gate: **FAIL**, exit 1, 27 successful / 139 scheduled tasks; 1m56.666s.
- Full gate: **FAIL**, exit 1, 53 successful / 183 scheduled tasks (26 cached); 2m0.839s.
- Both stop at `@jeswr/app-pod-manager#build`: `next/font` in
  `apps/pod-manager/src/app/layout.tsx` tries to fetch Inter from Google Fonts. The offline
  guard blocks the connection. That application source is unchanged by this lane.
- `agent/integration` is not present as a local ref in this dedicated checkout. The affected
  gate uses the exact base SHA supplied in the brief instead; no branch/ref was created.

Exact gate commands:

```sh
TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 ASTRO_TELEMETRY_DISABLED=1 GIT_ALLOW_PROTOCOL=file NODE_OPTIONS=--require=/tmp/sst-ito-offline.cjs TURBO_SCM_BASE=61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4 pnpm run gate --env-mode=loose
TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 ASTRO_TELEMETRY_DISABLED=1 GIT_ALLOW_PROTOCOL=file NODE_OPTIONS=--require=/tmp/sst-ito-offline.cjs pnpm run gate:full --env-mode=loose
```

Turbo's `--env-mode=loose` propagates the verification guard to task subprocesses. Gate tasks
are unchanged. Telemetry is disabled. Denied Google Fonts attempts did not result in a live
provider request. The gates terminate before all scheduled checks complete.

## Review, unfinished work, and open questions

Manual review checked history preservation, dependency mapping, public declarations, unchanged
exports/runtime logic, and fail-closed mirror pin requirements. Roborev was not invoked because
its model-provider calls conflict with this lane's explicit network restriction; commit hooks
were disabled for the integration and report commits for the same reason.

Remaining acceptance work:

- Obtain a complete passing personal-agent run and full-suite coverage baseline. Existing
  helper/SPARQ startup deadlines and the A2A test's 20-second bound fail on this host, including
  the focused single-worker rerun. These are unresolved validation failures, not asserted fixes.
- Obtain green affected/full gates with an offline font fixture or equivalent
  existing-app build support. The current Pod Manager build requires a forbidden external fetch.
- Automated roborev review remains unrun under this lane's provider-network restriction.

Both package flags remain unset. There are no open design questions. Conservative choices are
recorded above: preserve imported runtime behavior, TypeSafe until A-011, and existing security
limits. No PR, push, publish, new feature, tracker mutation, or source change in another checkout
is part of this lane's output. The bead must not be reported as fully verified.
