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

## Fix round 2 — review of `d084d70392b4`

Both transmission findings are fixed on `lane/sst-31t`. Changes are limited to
the direct sender, its regression tests and this report.

| Commit | Change |
| --- | --- |
| `ec88d5cc` | `fix: snapshot direct wire before asynchronous checks` — copy the wire before integrity checking and the first await; use the copy for verification, pending attempts, idempotency, provider references, accepted evidence and inbox delivery. Tests mutate the caller's wire during verification and credential retrieval, covering new sends and retries. |
| `911132dc` | `fix: recheck direct message freshness before delivery` — recheck the verified message after credentials resolve and before synchronous mailbox access. Tests cover just before expiry, exact expiry, after expiry, clock rollback and a non-finite clock; rejected attempts leave no delivery or pending evidence. |
| This final commit | `docs: record sst-31t round two verification` — this report. |

Verification uses Node 24.22.1 with `PATH=/opt/node24/bin:$PATH`. Both regressions
were demonstrated before applying their respective fixes: mutation returned the
replacement wire's provider reference at both suspension points, and delayed
credentials allowed delivery in all four cases with invalid times. The case just
before expiry already passed. All cases pass with the fixes.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; 5/5 tasks, preparing the workspace prerequisites absent from this fresh checkout. |
| `pnpm exec vitest run --root packages/agent-channels test/direct.test.ts --coverage.enabled=false -t snapshots` (before the snapshot fix) | Expected FAIL; both async-boundary regressions reproduced. |
| `pnpm exec vitest run --root packages/agent-channels test/direct.test.ts --coverage.enabled=false` (after the snapshot fix) | PASS; 13 tests at that point. |
| `pnpm exec vitest run --root packages/agent-channels test/direct.test.ts --coverage.enabled=false -t 'rechecks freshness'` (before the freshness fix) | Expected FAIL; 4 invalid-time cases delivered, while the just-before-expiry case passed. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` | PASS; 4 test files, 62 tests. Enforced per-file coverage: statements 167/167, branches 114/114, functions 35/35, lines 159/159 — all 100%. |
| `pnpm run lint:root` | PASS; all root lint and guard checks. |
| `TURBO_SCM_BASE=d084d70392b45599c147abdf4665283b71995db1 pnpm run gate` | PASS; 25/25 tasks, including 62 channel tests, 650 legacy-bridge tests, 121 model tests and 531 pilot tests. The starting lane SHA scopes this fix round; the original brief's `agent/integration` ref is still absent, as confirmed locally without fetching. |
| `pnpm run gate:full` | FAIL outside this fix: 282/345 tasks completed successfully before the existing `@jeswr/federation-trust#test` delegation-credential snapshot failed at `test/characterization.test.ts:196`. Expected JWK property order is `crv,x,kty`; received order is `kty,crv,x`, matching the previous lane reports. All 747 root tests passed in this run. |
| `git diff --check` | PASS. |

No dependencies were added, so no new `check:packages` run was required. Tests
use only local signatures, fake grants and the existing loopback transport.
No coverage threshold, timeout configuration or unrelated source was changed.

Both review findings are complete, with no open questions. The full-workspace
gate remains blocked by the unrelated federation-trust snapshot; that package
was left unchanged to respect fix-round scope. The 16 generated app callback and
client ID files were removed. No `dist/` is committed.

The `roborev` executable is still unavailable, so automated per-commit verdicts
could not be collected. No review tooling or tracker was installed.

## Fix round 3 — review of `6f89db4b8f83`

All three findings are fixed on `lane/sst-31t`. Changes are limited to the direct
sender, its regression tests and this report.

| Commit | Change |
| --- | --- |
| `0d6d30ab` | `fix: bind direct credentials to the delivery account` — snapshot and freeze the validated account reference before awaiting verification or credentials. Tests replace the caller's account and mutate its ID at both suspension points, checking credential scope and actual inbox delivery. |
| `7339e73e` | `fix: share pending direct sends by mailbox` — share the pending set through a mailbox-keyed WeakMap. Tests cover separately constructed senders, verification and credential delays, success, rejection, isolated mailboxes and overlapping attempts. |
| `e020ca8d` | `fix: snapshot direct lookup wire before verification` — use one checked wire snapshot throughout lookup. Tests replace the caller's wire while lookup verifies accepted bytes or a send paused at either asynchronous boundary. |
| This final commit | `docs: record sst-31t round three verification` — this report. |

Verification uses Node 24.22.1 with `PATH=/opt/node24/bin:$PATH` for all pnpm
commands. Each regression was reproduced before its corresponding fix: three
account-mutation cases requested credentials for the wrong account; the shared
sender cases returned premature absence; all three lookup-mutation cases lost
accepted or pending evidence. The existing safe account-replacement case during
credential retrieval and same-sender overlap case continued to pass.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; 5/5 tasks, preparing workspace prerequisites absent from this fresh checkout. |
| `pnpm exec vitest run --root packages/agent-channels test/direct.test.ts --coverage.enabled=false -t 'binds credentials'` (before the account fix) | Expected FAIL; 3 failed, 1 passed. |
| `pnpm exec vitest run --root packages/agent-channels test/direct.test.ts --coverage.enabled=false -t 'shared senders\|shares pending'` (before the shared-state fix) | Expected FAIL; 3 failed, 1 passed. |
| `pnpm exec vitest run --root packages/agent-channels test/direct.test.ts --coverage.enabled=false -t 'snapshots lookup'` (before the lookup fix) | Expected FAIL; all 3 regression cases reproduced. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` | PASS; 4 test files, 72 tests. Enforced per-file coverage: statements 171/171, branches 116/116, functions 35/35, lines 164/164 — all 100%. |
| `TURBO_SCM_BASE=6f89db4b8f833610cf073506fa6bc1c897956fc7 pnpm run gate` | PASS; root lint and 25/25 Turbo tasks, including 72 channel tests, 650 legacy-bridge tests, 121 model tests and 531 pilot tests. The supplied starting lane SHA scopes this fix round. |
| `pnpm run gate:full` | FAIL outside this fix: 282/344 tasks completed successfully before the existing `@jeswr/federation-trust#test` delegation-credential snapshot failed at `test/characterization.test.ts:196`. Expected JWK property order is `crv,x,kty`; received order is `kty,crv,x`, matching the previous lane reports. All 747 root tests passed. |
| `git diff --check` | PASS. |

No dependencies were added, so no new `check:packages` run was required. Tests
use only local signatures and fake grants. No coverage threshold, timeout
configuration or unrelated source was changed. There were no new test flakes.
The 16 generated app callback and client-ID files were removed; no `dist/` is
committed. No remote was fetched, no branch was switched, and no other checkout
was modified.

All requested fixes and regression tests are complete, with no open questions
or design changes. The unrelated federation-trust snapshot still blocks a green
full-workspace gate and was left unchanged to respect scope. The `roborev`
executable remains unavailable (`command -v roborev` found no executable), so
automated per-commit verdicts could not be collected. No review tooling or
tracker was installed.

## Fix round 4 — review of `fd2c20022c86`

All three findings are fixed on `lane/sst-31t`. Changes are limited to
agent-channels, its regression tests and this report.

| Commit | Change |
| --- | --- |
| `16aac36c` | `fix: bind direct reads to the selected account` — pass a frozen reference built from the validated inbox ID to `tokens.read`. The regression mutates the caller's ID while credentials are delayed, then checks the recorded grant account, returned inbox, cursor and immutability of the provider's reference. |
| `38e2d3e0` | `fix: preserve origin-scoped request integrity` — explicitly forward the snapshotted Request's effective integrity policy through guarded-fetch normalization. A real loopback transport accepts matching hashes and rejects mismatches for string, URL and Request inputs, including init overrides and explicit policy clearing. |
| `44d0beb3` | `fix: separate direct carrier and payload bounds` — bound the compact-JWS carrier string by the carriage byte limit and apply the model's default JSON bounds independently to verified payloads. Tests round-trip a real signed message within four bytes of the 64 KiB limit, reject oversized string/byte carriers, and reject decoded payload string, depth, array and node-count violations before credentials or delivery. |
| This final commit | `docs: record sst-31t round four verification` — this report. |

Verification uses Node 24.22.1 with `PATH=/opt/node24/bin:$PATH` for all pnpm
commands. Each regression was reproduced before its fix: the delayed read
requested credentials for the mutated account; a mismatched response hash was
accepted; a valid large signed message was refused at the carrier string limit.
The payload regressions also demonstrated that excessive decoded depth, array
length and node count were accepted before the independent payload bounds.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; 5/5 tasks, preparing workspace prerequisites in this fresh checkout. |
| `pnpm exec vitest run --root packages/agent-channels test/direct.test.ts --coverage.enabled=false -t 'delayed read credentials'` (before the read fix) | Expected FAIL; the recorded credential account differed from the selected inbox. |
| `pnpm exec vitest run --root packages/agent-channels test/origins.test.ts --coverage.enabled=false -t 'response integrity'` (before the integrity fix) | Expected FAIL; a mismatched integrity hash resolved successfully. |
| `pnpm exec vitest run --root packages/agent-channels test/direct.test.ts --coverage.enabled=false -t 'near the carriage\|decoded payload'` (before the bounds fix) | Expected FAIL; all five regression cases reproduced. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` | PASS; 4 test files, 79 tests. Enforced per-file coverage: statements 175/175, branches 116/116, functions 35/35, lines 168/168 — all 100%. |
| `TURBO_SCM_BASE=fd2c20022c86b8e6926e01cdb6a9ee03a491f14f pnpm run gate` | PASS; root lint and 25/25 Turbo tasks, including 79 channel tests, 650 legacy-bridge tests, 121 model tests and 531 pilot tests. The supplied starting lane SHA scopes this fix round; `agent/integration` remains absent locally. |
| `pnpm run gate:full` | FAIL outside this fix: 283/346 tasks completed successfully before the existing `@jeswr/federation-trust#test` delegation-credential snapshot failed at `test/characterization.test.ts:196`. Expected JWK property order is `crv,x,kty`; received order is `kty,crv,x`, matching previous lane reports. All 747 root tests passed. |
| `git diff --check` | PASS. |

No dependencies were added, so no new `check:packages` run was required. Tests
use local signatures, fake grants and loopback servers. No coverage threshold,
timeout configuration or unrelated source was changed. The conservative bounds
choice retains the model's default decoded-payload limits while allowing the
encoded carrier to use the advertised byte limit. There are no open design
questions or unfinished requested fixes.

The unrelated federation-trust snapshot still blocks a green full-workspace
gate and was left unchanged to respect fix-round scope. The 16 generated app
callback and client-ID files were removed; no `dist/` is committed. No remote
was fetched, no branch was switched, and no other checkout was modified.

The `roborev` executable remains unavailable, so automated per-commit verdicts
could not be collected. No review tooling or tracker was installed.

## Fix round 5 — review of `54e2275dd1b0`

Both findings are fixed on `lane/sst-31t`. Changes are limited to
agent-channels, its regression tests and this report.

| Commit | Change |
| --- | --- |
| `640b056e` | `fix: preserve effective channel fetch policies` — forward effective cache, mode, keepalive, referrer and referrer-policy settings alongside integrity through guarded-fetch normalization. Preserve inherited referrer settings when constructing the Request snapshot. Tests cover string, URL and Request inputs, partial overrides, explicit replacements and clearing; the real loopback transport confirms cache-bypass headers reach the server. |
| `07f20321` | `fix: bound direct carrier bytes before decoding` — reject byte carriers exceeding `DIRECT.maxBytes` before invoking TextDecoder. Tests accept the exact raw-byte boundary, reject a BOM-prefixed carrier whose decoded text fits, and prove oversized Buffer and Uint8Array inputs never reach decoding. Existing decoded JSON limits remain enforced. |
| `16e17da6` | `test: use guarded channel transport type` — use guarded-fetch's exported type for the injected test transport to satisfy the agent layer guard. |
| This final commit | `docs: record sst-31t round five verification` — this report. |

Verification uses Node 24.22.1 with `PATH=/opt/node24/bin:$PATH` for all pnpm
commands. Before the fixes, all five initial policy cases failed and the oversized
BOM-prefixed byte carrier was accepted. The regression suite also exposed Node's
Request-copy reset of inherited referrer settings; those are now supplied
explicitly before normalization. All final tests pass.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; 5/5 tasks, preparing workspace prerequisites in this fresh checkout. |
| `pnpm exec vitest run --root packages/agent-channels test/origins.test.ts test/direct.test.ts --coverage.enabled=false -t 'effective fetch policies\|bounds raw carrier'` (before the fixes) | Expected FAIL; all 6 initial regression cases reproduced. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` | PASS; 4 test files, 86 tests. Enforced per-file coverage: statements 178/178, branches 126/126, functions 35/35, lines 171/171 — all 100%. |
| `TURBO_SCM_BASE=54e2275dd1b0c4aa76da123b1da6518e6ecda1a7 pnpm run gate` (first attempt) | FAIL in root agent layer lint: the test's `typeof fetch` annotation was forbidden. Corrected to the guarded-fetch export in `16e17da6`. |
| `TURBO_SCM_BASE=54e2275dd1b0c4aa76da123b1da6518e6ecda1a7 pnpm run gate` (after the type correction) | PASS; root lint and 25/25 Turbo tasks, including 86 channel tests, 650 legacy-bridge tests, 121 model tests and 531 personal-agent tests. The supplied starting lane SHA scopes this fix round; `agent/integration` remains absent locally. |
| `pnpm run gate:full` | FAIL outside this fix: 291/346 tasks completed successfully before the existing `@jeswr/federation-trust#test` delegation-credential snapshot failed at `test/characterization.test.ts:196`. Expected JWK property order is `crv,x,kty`; received order is `kty,crv,x`, matching previous lane reports. All 747 root tests passed. |
| `git diff --check` | PASS. |

No dependencies were added, so no new `check:packages` run was required. Tests
use only fake transports and loopback traffic. No coverage threshold, timeout
configuration or unrelated source was changed. Both requested fixes and their
regression tests are complete, with no open questions or design changes.

The unrelated federation-trust snapshot still blocks a green full-workspace
gate. The 16 generated app callback and client-ID files were removed; no `dist/`
is committed. No remote was fetched, no branch was switched, and no other
checkout was modified.

The `roborev` executable remains unavailable, so automated per-commit verdicts
could not be collected. No review tooling or tracker was installed.

## Fix round 7 — review of `97b36aad087f`

Both findings are fixed on `lane/sst-31t`. Changes are limited to
agent-channels, its regression tests and this report.

| Commit | Change |
| --- | --- |
| `41d5359d` | `fix: preserve keepalive request bodies` — forward the normalized Request's keepalive body as an ArrayBuffer so guarded-fetch does not pass an explicit stream to the transport. A real loopback server checks POST bodies and content types for string, URL and Request inputs, inherited bodies, init overrides, URLSearchParams and a non-keepalive control. |
| `6e0873e0` | `fix: snapshot direct list bounds before authorization` — read both limits once into local primitives before validation, then use those values for pagination and byte accounting. Tests raise and lower each limit while read credentials are pending and check accessor-backed limits are read only once. |
| This final commit | `docs: record sst-31t round seven verification` — this report. |

Verification uses Node 24.22.1 with `PATH=/opt/node24/bin:$PATH` for all pnpm
commands. All six new regression cases failed before the fixes: the POST failed
with `TypeError: keepalive`, and every caller-owned bounds case changed the
validated pagination result. The final package gate passes. Its first attempt
caught two unchecked test-fixture array accesses during typecheck; those were
corrected before the passing run and included in the bounds commit.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; 5/5 prerequisite build tasks. |
| `pnpm exec vitest run --root packages/agent-channels test/origins.test.ts test/direct.test.ts --coverage.enabled=false -t 'body-bearing keepalive\|snapshots list\|reads each caller-owned list bound'` (before the fixes) | Expected FAIL; all 6 new regression cases reproduced. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` (final run) | PASS; 4 test files, 98 tests. Enforced per-file coverage: statements 179/179, branches 132/132, functions 35/35, lines 172/172 — all 100%. |
| `pnpm run lint:root` | PASS; all root lint and guard checks. |
| `TURBO_SCM_BASE=97b36aad087fb2b276e9e21072108fdf8940e924 pnpm run gate` | PASS; root lint and 25/25 Turbo tasks, including 98 channel tests, 650 legacy-bridge tests, 121 model tests and 531 personal-agent tests. The supplied starting SHA scopes this round; `agent/integration` remains absent locally. |
| `pnpm run gate:full` (first attempt) | FAIL outside this fix; 68/233 tasks completed successfully before two cases at `test/agent-layers.test.mjs:546` exceeded 5000 ms. Root tests: 745 passed, 2 timed out. |
| `pnpm exec vitest run test/agent-layers.test.mjs --testTimeout=60000` | PASS; all 345 tests, including the cases that timed out in both full-gate attempts. Only the command-line timeout was changed, as permitted by the original brief. |
| `pnpm run gate:full` (retry) | FAIL outside this fix; 101/279 tasks completed successfully before one case at `test/agent-layers.test.mjs:546` exceeded 5000 ms and `test/check-sdk-layers.test.mjs:328` measured 146.41 ms against its 50 ms limit. Root tests: 745 passed, 2 failed. |
| `pnpm exec vitest run test/check-sdk-layers.test.mjs -t 'validates pathological specs'` | PASS; the timing assertion passed unchanged in isolation. |
| `git diff --check` | PASS. |

No dependencies were added, so no new `check:packages` run was required. Tests
use fake grants and loopback traffic. Coverage thresholds, configured timeouts
and unrelated source remain unchanged. Both requested fixes and their
regression tests are complete, with no open questions or design changes.

The full-workspace gate remains blocked by the unrelated root timing failures
above. The isolated checks pass; no further full-gate retry or unrelated fix
was made. Both full runs stopped before the federation-trust snapshot failure
recorded in earlier rounds. No generated app files required cleanup, and no
`dist/` is committed. No remote was fetched, no branch was switched, and no
other checkout was modified.

The `roborev` executable remains unavailable, so automated per-commit verdicts
could not be collected. No review tooling or tracker was installed.

## Fix round 8 — review of `90a5770083ec`

The requested no-cors body regression is fixed on `lane/sst-31t`. Changes are
limited to agent-channels, its regression tests and this report.

| Commit | Change |
| --- | --- |
| `08b55b64` | `fix: preserve no-cors request bodies` — buffer the normalized Request body for `mode: "no-cors"`, as already done for keepalive, before forwarding to guarded-fetch. Extend the loopback POST regression to check string, URL and Request inputs, inherited and overridden bodies and modes, URLSearchParams, content types and a non-keepalive cors control. |
| This final commit | `docs: record sst-31t round eight verification` — this report. |

Verification uses Node 24.22.1 with `PATH=/opt/node24/bin:$PATH` for all pnpm
commands. Before the fix, the new no-cors case failed with the reported
ReadableStream/mode error; the existing keepalive case passed. Both cases pass
after the fix. The final package gate passes with all coverage thresholds intact.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; 5/5 prerequisite build tasks. |
| `pnpm exec vitest run --root packages/agent-channels test/origins.test.ts --coverage.enabled=false -t 'body-bearing'` (before the fix) | Expected FAIL; the no-cors case reproduced the streaming-body construction error, and the keepalive case passed. |
| `pnpm exec vitest run --root packages/agent-channels test/origins.test.ts --coverage.enabled=false -t 'body-bearing'` (after the fix) | PASS; both cases. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` | PASS; 4 test files, 99 tests. Enforced per-file coverage: statements 179/179, branches 133/133, functions 35/35, lines 172/172 — all 100%. |
| `TURBO_SCM_BASE=90a5770083ec387ea64a254c517f45a525fad6c5 pnpm run gate` | PASS; root lint and 25/25 Turbo tasks, including 99 channel tests, 650 legacy-bridge tests, 121 model tests and 531 personal-agent tests. The supplied starting SHA scopes this round; `agent/integration` remains absent locally. |
| `pnpm run gate:full` | FAIL outside this fix; 77/244 tasks completed successfully before one existing case at `test/agent-layers.test.mjs:546` exceeded 5000 ms. Root tests: 746 passed, 1 timed out. This is the same root timeout recorded in round seven. |
| `pnpm exec vitest run test/agent-layers.test.mjs --testTimeout=60000` | PASS; all 345 tests, including the case that timed out in the full gate. Only the command-line timeout was changed, as permitted by the original brief. |
| `git diff --check` | PASS. |

No dependencies were added, so no new `check:packages` run was required. Tests
use only loopback traffic and existing fakes. Coverage thresholds, configured
timeouts and unrelated source remain unchanged. The requested fix and its
regression coverage are complete, with no open questions or design changes.

The full-workspace gate remains blocked by the unrelated root timeout above;
the isolated test file passes. No further full-gate retry or unrelated fix was
made. No generated app files required cleanup, and no `dist/` is committed.
No remote was fetched, no branch was switched, and no other checkout was modified.

The `roborev` executable remains unavailable, so automated per-commit verdicts
could not be collected. No review tooling or tracker was installed.

## Fix round 9 — review of `931dd61ef5fd`

Both requested findings are fixed on `lane/sst-31t`. Changes are limited to
agent-channels, its regression tests and this report.

| Commit | Change |
| --- | --- |
| `d3224b7f` | `fix: bound and sanitize scoped fetch requests` — move keepalive/no-cors buffering into the guarded transport, under its existing combined caller/deadline signal. Cap buffered request bytes at 1 MiB and cancel/release readers on overflow, failure or abort without awaiting a potentially stalled cancellation. Reject URL userinfo before Request construction; replace URL, Request and binding-origin normalization failures with fixed errors that retain no native cause. Add 21 regression cases covering exact byte limits, overflow, stalled bodies, shared DNS/buffering deadlines, caller aborts, failed reads and cancellation, and credential-bearing normalization errors. |
| This final commit | `docs: record sst-31t round nine verification` — this report. |

Verification uses Node 24.22.1 with `PATH=/opt/node24/bin:$PATH` for all pnpm
commands. Both initial overflow regressions and all 12 normalization regressions
failed before their respective fixes. An intermediate coverage run exceeded the
default 5-second timeout while deeply comparing a 1 MiB typed array; replacing
that assertion with native `Buffer.equals` retained byte-for-byte verification
and removed the comparison overhead. Final package tests pass with unchanged
coverage thresholds and timeout configuration.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; 5/5 prerequisite build tasks. |
| `pnpm exec vitest run --root packages/agent-channels test/origins.test.ts --coverage.enabled=false -t 'bounds buffered'` (before the buffering fix) | Expected FAIL; both oversized bodies reached the fake transport. |
| `pnpm exec vitest run --root packages/agent-channels test/origins.test.ts --coverage.enabled=false -t 'sanitizes\|before Request construction'` (before the normalization fix) | Expected FAIL; all 12 regression cases reproduced. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` | PASS; 4 test files, 120 tests. Enforced per-file coverage: statements 219/219, branches 145/145, functions 40/40, lines 210/210 — all 100%. |
| `TURBO_SCM_BASE=931dd61ef5fd105bd9f6471cfd5386950cfe4530 pnpm run gate` | PASS; root lint and 25/25 Turbo tasks, including 120 channel tests, 650 legacy-bridge tests, 121 model tests and 531 personal-agent tests. The supplied starting SHA scopes this round; `agent/integration` remains absent locally. |
| `pnpm run gate:full` | FAIL outside this fix; 74/241 tasks completed successfully before five cases at `test/agent-layers.test.mjs:546` exceeded 5000 ms and `test/check-sdk-layers.test.mjs:328` measured 65.14 ms against its 50 ms limit. Root tests: 741 passed, 6 failed. These are the root timing failures recorded in earlier rounds. |
| `pnpm exec vitest run test/agent-layers.test.mjs --testTimeout=60000` | PASS; all 345 tests, including the five cases that timed out in the full gate. Only the command-line timeout was changed, as permitted by the original brief. |
| `pnpm exec vitest run test/check-sdk-layers.test.mjs -t 'validates pathological specs'` | PASS; the timing assertion passed unchanged in isolation. |
| `git diff --check` | PASS. |

The conservative buffering cap matches guarded-fetch's existing 1 MiB default
response limit. Buffering shares its existing 10-second operation deadline;
there is no additional buffering timer or timeout reset. Existing keepalive,
no-cors, body override, content-type, integrity and fetch-policy regressions pass.
No dependencies were added, so no new `check:packages` run was required. Tests
use only existing fakes and loopback traffic. Both requested fixes are complete,
with no open questions or unfinished implementation work.

The full-workspace gate remains blocked by the unrelated root timing failures
above; the isolated checks pass. No further full-gate retry or unrelated fix was
made. No generated app files required cleanup, and no `dist/` is committed.
No remote was fetched, no branch was switched, and no other checkout was modified.

The `roborev` executable remains unavailable, so automated per-commit verdicts
could not be collected. No review tooling or tracker was installed.

## Fix round 10 — review of `37cd5ac17c93`

Both requested findings are fixed on `lane/sst-31t`. Changes are limited to
agent-channels, its regression tests and this report.

| Commit | Change |
| --- | --- |
| `6bc55520` | `fix: sanitize inner channel transport errors` — replace errors from the inner transport/refusal wrapper with a fixed error without the original cause. Loopback tests cover malformed credential-bearing redirect locations through default and injected Node transports; a fake transport verifies nested error details are discarded. |
| `77898534` | `fix: bound direct cursors before parsing` — cap encoded cursor length at 16 KiB before parsing, reuse bounded JSON parsing with a 16 KiB byte limit and depth limit of two, and require exactly the account and nonnegative safe-integer offset fields before read authorization. Tests cover parse avoidance, exact length boundaries, malformed shapes, non-string inputs and the longest accounts with JSON escapes. |
| This final commit | `docs: record sst-31t round ten verification` — this report. |

Verification uses Node 24.22.1 with `PATH=/opt/node24/bin:$PATH` for all pnpm
commands. Before the fixes, eight regression cases failed, reproducing both
findings. Final package tests pass with all coverage thresholds intact.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/agent-channels` | PASS; 5/5 prerequisite build tasks. |
| `pnpm exec vitest run --root packages/agent-channels test/origins.test.ts test/direct.test.ts --coverage.enabled=false -t 'sanitizes inner\|complete inner\|encoded cursors\|cursor nesting\|cursor shape\|non-string cursors\|longest accounts'` (before the fixes) | Expected FAIL; 8 failed, 14 passed, 80 skipped. |
| `pnpm --filter @jeswr/agent-channels run lint && pnpm --filter @jeswr/agent-channels run build && pnpm --filter @jeswr/agent-channels run typecheck && pnpm --filter @jeswr/agent-channels run test` (final run) | PASS; 4 test files, 142 tests. Enforced per-file coverage: statements 226/226, branches 154/154, functions 40/40, lines 217/217 — all 100%. An initial lint attempt caught test formatting, corrected before this passing run. |
| `TURBO_SCM_BASE=37cd5ac17c93d09d93f94d07f4b6ddc61fa20174 pnpm run gate` | PASS; root lint and 25/25 Turbo tasks, including 142 channel tests, 650 legacy-bridge tests, 121 model tests and 531 personal-agent tests. The supplied starting SHA scopes this round; `agent/integration` remains absent locally. |
| `pnpm run gate:full` | FAIL outside this fix; 83/262 tasks completed successfully before two existing cases at `test/agent-layers.test.mjs:546` exceeded 5000 ms (`export * from TARGET;` and `module.require.resolve(TARGET);`). Root tests: 745 passed, 2 timed out. These are the root timing failures recorded in earlier rounds. |
| `pnpm exec vitest run test/agent-layers.test.mjs --testTimeout=60000` | PASS; all 345 tests, including both cases that timed out in the full gate. Only the command-line timeout was changed, as permitted by the original brief. |
| `git diff --check` | PASS. |

The conservative transport-error choice discards the original inner diagnostic
chain entirely. The cursor cap accommodates the existing 2048-character account
limit even with maximal JSON escaping. No dependencies were added, so no new
`check:packages` run was required. Tests use only existing fakes and loopback
traffic. Coverage thresholds, configured timeouts and unrelated source remain
unchanged. Both requested fixes are complete, with no open questions or
unfinished implementation work.

The full-workspace gate remains blocked by the unrelated root timeouts above;
the isolated test file passes. No further full-gate retry or unrelated fix was
made. No generated app files required cleanup, and no `dist/` is committed.
No remote was fetched, no branch was switched, and no other checkout was modified.

The `roborev` executable remains unavailable, so automated per-commit verdicts
could not be collected. No review tooling or tracker was installed.
