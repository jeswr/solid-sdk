<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-31t / A-005 lane report

Implemented on `lane/sst-31t`, based on
`93217230daa254393b7c3b0f38956cd5de8bbbd1`. No fetch, push, PR, branch switch,
provider request, real credential access or other-checkout mutation was performed.

## Commits

| Commit | Change |
| --- | --- |
| `24fa67de` | `chore: order agent model builds before pilot tests` — package Turbo override builds model production dependencies first and retains the pilot build before typecheck/tests. |
| `b311d33a` | `feat: enforce binding origins before network access` — origin snapshot, DNS-pinning guarded-fetch default, redirect refusal, loopback/fake-transport tests and workspace dependency edges. |
| `29e42e10` | `feat: add channel contracts and direct test binding` — DESIGN §3.1 contracts; shared legacy message/channel/email/reply shapes and compatibility re-exports; carriage constants; capability RDF/golden; recording scope-separated grants; direct ingest/send test binding; layer checks; package documentation. |
| This final commit | `docs: record sst-31t verification` — this report. |

## Verification

All commands ran within this checkout. No test used a live provider or a real pod.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` | PASS; 4 test files, 51 tests. Enforced per-file coverage: statements 100% (154/154), branches 100% (112/112), functions 100% (34/34), lines 100% (148/148). |
| `pnpm --filter @jeswr/agentic-legacy-bridge run lint && pnpm --filter @jeswr/agentic-legacy-bridge run build && pnpm --filter @jeswr/agentic-legacy-bridge run typecheck && pnpm --filter @jeswr/agentic-legacy-bridge run test --testTimeout=30000 --hookTimeout=30000` | PASS; 37 test files, 650 tests. |
| `pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage --testTimeout=30000 --hookTimeout=30000` | PASS; 650 tests. Existing non-SEC package coverage: statements 93.98%, branches 86.64%, functions 97.57%, lines 96.35%. No thresholds were weakened. |
| `pnpm --filter @jeswr/agent-model run lint && pnpm --filter @jeswr/agent-model run build && pnpm --filter @jeswr/agent-model run typecheck && pnpm --filter @jeswr/agent-model run test --testTimeout=30000 --hookTimeout=30000` | PASS; 7 test files, 121 tests. Runtime model code is unchanged. |
| `pnpm exec vitest run test/agent-layers.test.mjs test/agent-layers-reachability.test.mjs --testTimeout=30000` | PASS; 382 tests, including type-only `./gmail/send` rejection outside the executor and production rejection of the composed test factory. |
| `pnpm run lint:root` | PASS; Biome, workspace/transport/layer guards, fetch guard, tokens and contrast checks. |
| `TURBO_SCM_BASE=agent/integration pnpm run gate` | Root lint PASS; Turbo could not resolve `agent/integration`, which is absent in this checkout. No ref was created or fetched. |
| `TURBO_SCM_BASE=93217230daa254393b7c3b0f38956cd5de8bbbd1 pnpm run gate` | PASS against the exact base SHA supplied in the brief: 26/26 tasks. Includes 747 root tests, 51 channel tests, 650 bridge tests, 121 model tests and 531 pilot tests. |
| `pnpm run gate:full` | FAIL outside this lane: 285/346 tasks completed successfully before `@jeswr/federation-trust#test` failed its delegation-credential inline snapshot. The difference is JSON JWK property order (`crv,x,kty` versus `kty,crv,x`) at `packages/federation-trust/test/characterization.test.ts:196`. No federation-trust files or its runtime dependencies were changed here. |
| `git diff --check` | PASS. |

Dependency-first preparation used
`pnpm exec turbo run build --filter=@jeswr/agent-channels` and
`pnpm exec turbo run build --filter=@jeswr/agentic-legacy-bridge --filter=@jeswr/personal-agent`.
Both passed after preserving the legacy `MimePart` type import. The Turbo task
override fixes the build-task cycle caused by the pre-existing model → pilot test
dependency and the required legacy-bridge → channels → model migration. The
manifest graph still produces a circular-dependency warning; its executable task
graph completes successfully.

The origin test proved zero requests reached an undeclared local server. The
direct test uses locally generated Ed25519 signatures and exercises render,
validate, transmit, lookup, expiry, invalid signatures, tampering, conflicting ids
and destinations, missing/wrong grants, dry-run, bounded pagination and hostile
input. The capability Turtle matches the committed golden and round-trips through
the existing typed agent-model RDF mapping.

No timeout flakes occurred. Longer CLI timeouts were used for the bridge/model
checks as permitted by the brief; no timeout configuration was raised. Generated
app callback/client-id assets from the full gate were removed. No `dist/` was
committed.

## Dependency policy

`pnpm run check:packages @jeswr/agent-model @jeswr/guarded-fetch @jeswr/agent-channels --mode policy`
passed for all three names before manifest changes. These are existing workspace
packages, added with `workspace:*`; no third-party dependency was added. Registry
existence/age checks do not apply to workspace links.

`pnpm install --offline --ignore-scripts` and
`pnpm install --offline --ignore-scripts --frozen-lockfile` passed. The lockfile
diff contains only the three new workspace links; unrelated peer-resolution churn
was excluded. Lifecycle scripts remained disabled.

## Conservative interpretations

- Only email's provider byte limit is specified in DESIGN §3.2. Other structured
  profiles use the pilot's 64 KiB local ceiling; footer-only profiles use a
  conservative 256-byte ceiling pending their binding tasks. LinkedIn/X use
  zero-byte read-only profiles. These are documented local bounds, not claims
  about provider limits.
- Email parsing and the email-default adapter constructor remain compatibility
  wrappers in legacy-bridge. Shared types, conversions, error identity and the
  explicit-parser memory adapter live in agent-channels, avoiding a reverse edge.
- Capability RDF delegates to agent-model's existing Solid Resource / RDFJS
  wrapper accessors and rdf-serialize implementation. No duplicate vocabulary or
  hand-built triples were introduced. The direct descriptor has zero owner rate
  limits by default, and makes no authorization claim.
- The direct signature/key/audience verifier is an injected pure local seam.
  Parsing remains untrusted. Rendering is deterministic; validation/transmission
  enforce freshness, while exact positive-evidence lookup works after expiry.
- The `./testing` factory composes the two direct halves through one narrowly
  permitted internal re-export. Production imports of that factory fail layer
  lint; no other channel send edge was relaxed.

## Unfinished, blocked and open questions

Implementation and acceptance tests are complete. The full workspace gate remains
blocked by the unrelated federation-trust snapshot described above; it was left
unchanged to respect lane scope. The requested symbolic integration ref is absent;
the equivalent supplied base SHA passed.

The mandated roborev workflow was checked, but the `roborev` executable is not
installed in this sandbox, so automated per-commit verdicts are unavailable. No
review tooling or tracker was installed, and no other checkout was accessed.

No design questions remain for this lane. No provider implementation from later
tasks, deployment, publishing or live transmission was attempted.

## Fix round 1 — review of `e24ef0eb2c2e`

Both findings are fixed on `lane/sst-31t`, without dependencies or changes to
other packages.

| Commit | Change |
| --- | --- |
| `1ffb6e88` | `fix: refuse redirects in the inner channel transport` — set the default Node transport's `maxRedirects` to zero. Loopback tests cover 301, 302, 303, 307 and 308 for same-origin and undeclared-origin destinations, including a caller-supplied `redirect: follow`; no redirect target receives a request. |
| `f0b090f6` | `fix: defer direct absence until pending sends settle` — register each matching-wire attempt before asynchronous verification or credential lookup, return `unknown` while pending, and clear it on success or failure. Tests cover both suspension points, rejection, overlapping attempts, unrelated wires and positive evidence during retries. |
| This final commit | `docs: record sst-31t fix verification` — this fix-round report. |

Verification uses Node 24.22.1 (`PATH=/opt/node24/bin:$PATH`). Both new regressions
were checked against the original implementations: the default transport followed
a redirect, and all three pending-send cases incorrectly returned `absent`.
Restoring the fixes makes those tests pass.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; built workspace prerequisites, which were initially absent in this fresh checkout. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` | PASS; 4 test files, 55 tests. Enforced per-file coverage remains 100%: statements 165/165, branches 114/114, functions 35/35, lines 157/157. |
| `pnpm run lint:root` | PASS; all root lint and guard checks. |
| `TURBO_SCM_BASE=agent/integration pnpm run gate` | Root lint PASS; Turbo cannot resolve the absent `agent/integration` ref. No ref was created or fetched. |
| `pnpm run gate:full` | FAIL outside this fix: 278/346 tasks completed successfully before the existing `@jeswr/federation-trust#test` delegation-credential snapshot failed at `test/characterization.test.ts:196`. Expected JWK key order is `crv,x,kty`; received order is `kty,crv,x`, matching the original lane's recorded failure. All 747 root tests passed in this run. |
| `TURBO_SCM_BASE=e24ef0eb2c2eae50a0095aa6f0fc1089911336e2 pnpm run gate` (first attempt) | FAIL in an unrelated root timing assertion at `test/check-sdk-layers.test.mjs:328`: 56.66 ms exceeded its 50 ms limit. Turbo had included generated app files in its scope (51 tasks; 36 completed). The same test passed during the full gate; the generated files were removed before retrying. |
| `TURBO_SCM_BASE=e24ef0eb2c2eae50a0095aa6f0fc1089911336e2 pnpm run gate` (after cleanup) | PASS; 26/26 tasks, including 747 root tests, 55 channel tests, 650 bridge tests, 121 model tests and 531 pilot tests. |
| `git diff --check` | PASS. |

No dependencies were added, so no new `check:packages` run was required. All new
test traffic stays on loopback; signing keys and grants are local test fixtures.
No timeout configuration, coverage threshold or unrelated source was changed.

Both review findings are complete, with no open design questions. The unrelated
federation-trust snapshot still blocks the full-workspace gate. The root timing
failure passed on retry without changes to its test or limit. Generated app
callback/client-ID files were removed, and no `dist/` is committed.

The `roborev` executable remains unavailable in this sandbox, so automated
per-commit verdicts could not be collected. No review tooling was installed.
