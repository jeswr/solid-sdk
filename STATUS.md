<!-- AUTHORED-BY Codex GPT-6 -->

# sst-b8c.1 — A-002H personal-agent pilot hardening

Branch: `lane/sst-b8c.1`. Supplied integration base:
`12643bf0bf1d66802271494c02b42964ac86eebe`.
All three requested defects are fixed. The additional authorization audit is below,
including two residual findings listed under the brief's fix-or-list allowance.

## Implementation commits

| Commit | Change |
| --- | --- |
| `f19517cd` | Remove proposal-write pre-approval; gate writes inside the real MCP handler and a mandatory `PreToolUse` hook. Test pre-approved SDK permission ordering and direct MCP dispatch. |
| `58e14e94` | Recompute confirmation requirements at execution from the configured, Actor-unwritable Reader inbox. Require confirmation for absent, ambiguous, uncalibrated, security-bearing, or mismatched provenance. |
| `30cbaf03` | Record request operation/version/basis/direction; correlate deliveries before transitions and handler dispatch. Select the handler from the recorded request. |
| `6a6875b5` | Bind confirmation digests to `derivedFrom`; reject ambiguous assertions and stricter duplicate assessments of offered data. |

## Trust boundaries and conservative choices

The live write handler independently validates and reserializes the proposal before PUT,
even if SDK permission callbacks/hooks are bypassed. The hook runs before pre-approval;
`allowedTools` contains only read tools. Tests use the real in-memory MCP client/server
and a stub of the relevant SDK permission order, following the
[SDK permission documentation](https://code.claude.com/docs/en/agent-sdk/permissions).
No SDK model/provider was invoked.

`ExecutorConfig.inbox` is an optional trusted Reader-container setting. Omitting it,
overlapping it with proposals, or failing provenance verification requires confirmation.
The executor reconstructs the pilot's exact deterministic scheduling reply, normalizes it
through proposal persistence, and compares all send-affecting fields. This conservative
choice keeps arbitrary LLM drafts behind owner confirmation even with a broad permit.
An Actor-written flag can add confirmation but cannot remove the requirement.

Reader records must have unambiguous calibration, confidence, assertion and source linkage.
The bridge's canonical schema omits `securityBearing` when false. Security-bearing or
lower-reliability duplicate assessments cannot be hidden by selecting the first record.
Provenance reads stay inside the configured inbox, require Turtle and refuse redirects;
Actor-supplied source IRIs are never fetched directly.

Delivery correlation supports public/represented/grant invocations, direct delivery under
an accepted agreement, and explicit invocations of a different operation under an agreement.
It rejects wrong references, operation IDs/versions, bases, directions and duplicate deliveries.
Signed runtime regression tests show invalid deliveries preserve conversation state and
call neither the requested nor an unrelated handler.

Compatibility is fail-closed: pre-change confirmation digests require owner re-confirmation.
Legacy conversation snapshots without recorded requests reject deliveries rather than
infer their authorization basis.

## Authorization audit: actor, outbox and mandate

| Surface | Finding / disposition |
| --- | --- |
| Actor options, gate, live adapter and proposal server | Fixed pre-approval bypass. Both mandatory hook and implementation enforce proposal/ACL/ACP/container validation. Read-only MCP scope and credentials without control rights remain required. |
| Actor derivation, interpretation reads and deterministic runner | Their results are proposal intents. The executor now independently reloads Reader records and validates exact content, calibration and all assessments of offered data; Actor-selected confidence filters or flags cannot grant autonomy. |
| Executor action, channel, recipient, purpose, spend and reply target | The concrete send action remains `distribute`, with mismatched labels prohibited. Autonomous intents must match the trusted reconstruction. Confirmed intents bind channel, recipient, purpose, spend and both source/reply pointers in the digest. See the residual policy-claims finding below. |
| Executor status and idempotency | Terminal Actor statuses can suppress a proposal; `confirmed`/timestamps cannot authorize sending. Actor-unwritable receipts and create-only claims remain the idempotency authority. Reconstructed proposal IDs prevent autonomous duplicate sends under invented IDs. |
| Confirmation digest / carrier / receipt | Fixed the omitted `derivedFrom` binding, including its fallback use as the mandate target. Body, recipient, channel, purpose, spend, offered times, action and reply linkage are content-locked; provenance cannot be swapped after owner approval. |
| `outbox/confirm.ts:classifyFriction` | **Residual:** Actor-supplied `inReplyTo` and `spend` still determine acknowledgement strength. A forged reply anchor can make a novel recipient low-friction despite recomputing the advisory `friction` field. A real owner acknowledgement is still required; this does not enable an unconfirmed send. |
| `mandate/evaluate.ts:buildRequestContext` | **Residual:** arbitrary owner-confirmed drafts still use declared purpose/spend/reply target for scoped policy constraints and prohibitions. The declarations are digest-bound, but their semantics are not independently attested. A misleading purpose can change scoped-prohibition matching. Autonomous drafts are restricted by trusted reconstruction. |
| Mandate loader/verifier, default policy and types | Owner signature, issuer, policy-content binding and scoped policy fetching remain authoritative. Actor input cannot replace the verifier/configuration or write the mandate through the live tools. Default outbound policy remains confirmation-required. |
| Sender seam and public exports | Send credentials stay in injected deterministic sender closures. No new credential access or public entrypoint changes. |

The two residual findings are listed rather than introducing a new confirmation API or
semantic authorization design outside this brief. Resolving them needs trusted inputs for
known-thread/spend classification and policy claims on arbitrary drafts. This lane does
not claim they are resolved or that the stack is ready for a live channel run.

## Validation

Host: Node `v24.22.1`, pnpm `10.4.1`, Vitest `4.1.10`.
All package tests use synthetic fixtures, injected I/O, in-memory stores and loopback services.

| Check | Result |
| --- | --- |
| Dependency-first build | PASS: eight dependency build tasks. |
| Package gate: `pnpm --filter @jeswr/personal-agent run gate --maxWorkers=1` | PASS: lint, build, typecheck and **519 tests in 56 files**. Test duration 84.04s. |
| Separate package test run with `--maxWorkers=1` | PASS: **519 tests in 56 files**, 128.94s. |
| `pnpm --filter @jeswr/personal-agent run test:coverage --maxWorkers=1` | PASS: **519 tests in 56 files**, 89.01s. |
| `pnpm run lint:root` | PASS, including lockfile, workspace and raw-fetch guards. |
| Root tests, through the repository gates | PASS: **28 tests in two files**; replayed from cache in the full gate. |
| `pnpm run gate --env-mode=loose` | FAIL: unchanged `@jeswr/federation-trust#test`; 138 successful / 201 scheduled tasks, 56.337s. |
| `pnpm run gate:full --env-mode=loose` | FAIL: same unchanged test; 184 successful / 236 scheduled tasks, 1m6.255s. |

Coverage includes all non-test TypeScript under `packages/personal-agent/src/`:

| Statements | Branches | Functions | Lines |
| --- | --- | --- | --- |
| 87.02% | 74.91% | 90.48% | 89.56% |

The new write handler and Actor options each have 100% coverage across all four metrics.
The provenance module has 96.61% statements, 91.04% branches, 100% functions and 96.07% lines.
No coverage thresholds, package security-critical flags, timeouts or enforcement budgets changed.

Initial concurrent package-test/coverage attempts hit existing transmission, A2A and
persistence test timeouts and were cancelled. Completed runs were sequential with one
worker and the original timeouts. Those completed runs passed in full.

Both repository gates stopped at `packages/federation-trust/test/characterization.test.ts:196`,
“delegation credential structure is stable”: the embedded Ed25519 `delegateKey` JSON expects
property order `crv,x,kty`, while this host produces `kty,crv,x`. That package reports 53
passing / one failing test. Its source and `solid-vc` are unchanged from the supplied base;
the same blocker was recorded by the preceding lane. Both repository gates ran before
this final report commit, and neither completed every scheduled task.

## Scope, review and remaining acceptance work

All builds/gates used `GIT_ALLOW_PROTOCOL=file`. An existing dependency bootstrap's remote
clone was blocked by that setting. The already-present source at the exact lockfile pin
`a8359a3764cb6b3c763e09ea211542a5dc7edc33` was compiled with installed TypeScript in temporary
scratch space and copied into ignored dependency output. No remote Git fetch/merge occurred.

No dependencies, manifests, lockfile or tracked dist changed. No push, PR, publish, branch
switch, tracker mutation, provisioning, real credential-store access or live channel/model
run occurred. Gate-generated app callback/client-ID files were removed. Work stayed in this
checkout, with temporary build/test scratch under `/tmp`.

The diff and authorization paths were manually reviewed. Automated roborev review remains
unavailable because its CLI is not installed; no automated verdict is claimed.

Remaining acceptance work: the two listed authorization-audit residuals, the unrelated
repository snapshot blocker, and automated review. There are no open design questions
for this lane. STATUS.md is the last changed file and its report is the final lane commit.

## Fix round 1 — review of `dfb43effb461`

Both findings in the supplied review are fixed on `lane/sst-b8c.1`:

| Commit | Change |
| --- | --- |
| `fbe505f5` | Reuse proposal persistence's UTC timestamp normalization before matching duplicate Reader assessments. Regressions cover equivalent positive/negative offsets, fractional seconds, distinct instants and invalid timestamps. |
| `b7494d28` | Derive direct agreement delivery direction from the local operation handler's declared `agreementDelivery` obligation. Cover offeror/acceptor suppliers, inbound/outbound offers, invalid correlations, duplicate results and signed runtime dispatch. |

The conservative choice for operations without a declared direct-result supplier is to
require an explicit invocation. Existing mortgage handlers explicitly declare their
acceptor delivery obligations. Operation ID/version, reference, basis, direction and
duplicate-delivery checks remain enforced before committing delivery state or dispatching
a handler. The supplier declaration comes from local handlers, never peer message fields.

Regressions reproduced both review findings before the fixes. Final validation used
Node `v24.22.1`, pnpm `10.4.1` and Vitest `4.1.10`:

| Check | Result |
| --- | --- |
| Dependency-first build | PASS: eight tasks. Reused ignored fetch-rdf output matching the exact installed lockfile source pin. |
| `pnpm --filter @jeswr/personal-agent run gate --maxWorkers=1` | PASS: lint, build, typecheck and **531 tests in 56 files**; test duration 59.69s. |
| `pnpm --filter @jeswr/personal-agent run test:coverage --maxWorkers=1` | PASS: **531 tests in 56 files**; duration 100.48s. |
| `pnpm run lint:root` | PASS, including lockfile, workspace and fetch guards. |
| `pnpm run gate --env-mode=loose` | FAIL: unchanged `@jeswr/federation-trust#test`; 156 successful / 213 scheduled tasks, 45.042s. |
| `pnpm run gate:full --env-mode=loose` | FAIL: same unchanged test; 134 successful / 198 scheduled tasks, 1m47.318s. |

Coverage: **87.04% statements, 75.01% branches, 90.48% functions, 89.56% lines**.
Both repository gates stopped at the previously recorded
`packages/federation-trust/test/characterization.test.ts:196` delegation snapshot: the
Ed25519 `delegateKey` JSON expects `crv,x,kty`, while this host emits `kty,crv,x`.
That package reports 53 passing / one failing test. Its source and `solid-vc` remain
unchanged from the supplied review head. Neither repository gate completed every task.

Only the two requested findings and their regressions were implemented. The earlier
authorization-audit residuals remain outside this fix round. No dependencies, manifests,
lockfile or tracked build output changed. Gate-generated callback/client-ID files were
removed. Both repository gates ran before this final status commit.

Automated roborev review remains unavailable because its CLI is not installed; the diff
and authorization paths were manually reviewed. No push, PR, branch switch or tracker
mutation occurred. Open questions for this fix round: none.
