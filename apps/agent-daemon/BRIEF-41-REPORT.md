<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 41, Phase 1

The compatibility probe ran before any production edit. A fictional pinned peer signed a
pilot-profile Ed25519 `describe` with `craftSigned`. W17's `encodeEnvelope` and `readEnvelope`
round-tripped the compact JWS byte-for-byte. The unchanged reference runtime returned
`accepted` with the expected ID and no reason or detail, using a deny-all reference mandate.
The compatibility stop condition did not trigger.

## Changes

| File and line | Change |
| --- | --- |
| `apps/agent-daemon/package.json:10`, `:44`, `pnpm-lock.yaml:207` | Classified the daemon as security-critical and declared the locked workspace dependency on agent-reference. |
| `apps/agent-daemon/src/gate.ts:20`, `:61`, `:74`, `:95`, `:117` | Added the gate contract, carrier collection, ordered use of the reference runtime, body-free verdicts, crash markers and replay handling. |
| `apps/agent-daemon/src/gate.ts:199`, `:215`, `:231`, `:241`, `:275` | Opened the provisioned runtime with pinned trust, private state and a verified ledger. Added offline local status and a port that opens under the daemon lease. |
| `apps/agent-daemon/src/local.ts:21`, `:45` | Reused the existing no-follow private read and atomic fsynced write for verdict files. |
| `apps/agent-daemon/src/gate-setup.ts:20`, `:76`, `:124` | Provisioned the deny-all mandate and separately held owner key after confirmation. Validated, displayed and persisted the operator's reviewed Introduction Card. |
| `apps/agent-daemon/src/cli.ts:50`, `:118`, `:129`, `:227` | Added offline `awp gate init --owner-dir <dir>`, `pin <card.json>` and `status`. Mutating commands take the process lease after confirmation. |
| `apps/agent-daemon/src/types.ts:39`, `src/daemon.ts:78`, `:146`, `:227`, `:270`, `:386`, `:462` | Required a gate, checked the whole parsed batch before import, passed verdicts to both models, restricted automatic proposals to admitted messages and held the runtime through executor drain. |
| `apps/agent-daemon/src/index.ts:9`, `src/testing.ts:14` | Exported the host gate and setup API and added synthetic pinned peers with a memory-backed runtime. |
| `packages/agent-channels/src/matrix.ts:152`, `test/matrix.test.ts:223` | Labeled native Matrix carriers `signature-unverified` and tested the label. |
| `apps/agent-daemon/README.md:58`, `:144`, `SKILL.md:59`, `packages/agent-channels/README.md:54`, `SKILL.md:59` | Documented the import boundary, ownership, fail-closed host composition, CLI and pure carriage contract. |
| `apps/agent-daemon/test/composition.test.ts:52`, `test/css.test.ts:298`, `test/polling-executor.test.ts:143`, `test/daemon.test.ts:145`, `demos/d2-spending-limits.test.ts:262` | Gave existing test and demo compositions explicit test ports. |
| `apps/agent-daemon/test/exports.test.ts:32`, `tsconfig.test.json:6` | Updated the pinned public export surface and let test-only typechecking reuse the channel package's existing fixtures. |

Phase 1 changes are under the daemon and channel package, with one importer entry in the
workspace lockfile. The final run used a fresh library-only build of agent-reference.

## Tests and initial results

| Test | Initial result and final assertion |
| --- | --- |
| `apps/agent-daemon/test/gate.test.ts:7` | The first run passed as required by the compatibility stop condition. It checks exact preserved JWS bytes and a reference admission. |
| `apps/agent-daemon/test/daemon.test.ts:1060`, `:1105`, `:1137` | All five ran red before implementation. Missing-gate construction and a rejecting gate did not throw, and the three routing cases observed no gate call. They now assert mandatory composition, a single parse, model labels, filtering, and batch failure before inbox and cursor writes. |
| `apps/agent-daemon/test/daemon.test.ts:1164` | The original ten reason cases ran red before implementation because the gate fixture did not exist. The table now also verifies no model call, inbox write or suite ingest audit for each refusal, even on an owner-flagged thread. It covers bad signature, unknown key, expired/future windows, wrong audience, replay conflict, conflicting copies, parity mismatch, malformed and oversized carriers. Unsupported configuration was added during review. |
| `apps/agent-daemon/test/gate-setup.test.ts:39`, `:49`, `:71`, `:88` | All four ran red before implementation with `initGate is not a function`. They cover owner custody, confirmation, existing paths, private modes, thumbprint mismatch, interrupted digest recovery and tampered ledger refusal. |
| `packages/agent-channels/test/matrix.test.ts:221` | Ran red before the warning change. The received warning list was empty. It now expects `signature-unverified` for an actual Matrix carrier. |
| `apps/agent-daemon/test/gate-channels.test.ts:169`, `:194`, `:257` | Added after the gate existed. The first matrix run failed on a mismatched Matrix device account in the fixture. The final cases check one signed JWS and one signature mutation through six carriers, actual conflicting and mismatched MIME copies, and unstructured Discord, Mastodon, X and GitHub input. |
| `apps/agent-daemon/test/daemon.test.ts:1067`, `:1267`, `:1331`, `test/gate-setup.test.ts:139`, `:200` | Additional checks added during integration and review. They exercise runtime lease ordering, real bad-signature suppression, one inbox resource on retry, plain email with both flag states, durable restart replay, positive pinning and offline CLI setup/status. No pre-implementation run was recorded for these supplemental cases. |

## Validation commands

All Node and pnpm commands used `PATH=/opt/node24/bin:$PATH` (Node 24.22.3).
Every Vitest invocation used `--maxWorkers=2`.

| Command | Result |
| --- | --- |
| Daemon `npx --no-install vitest run test/gate.test.ts --maxWorkers=2` | Initial compatibility probe passed, 1 test. A subsequent red run found the ten missing-fixture cases. The first implemented run also found two fixture errors. The reference knows its own key and allows five minutes of clock skew, so the fixtures now use a genuinely unpinned key and an expiry beyond the skew. |
| Daemon `npx --no-install vitest run test/daemon.test.ts --maxWorkers=2 -t 'requires an inbound gate\|routes a structured message\|rolls back the entire batch'` and `npx --no-install vitest run test/gate-setup.test.ts --maxWorkers=2` | Recorded 5/5 and 4/4 expected red cases before implementing the gate. |
| Channels `npx --no-install vitest run test/matrix.test.ts --maxWorkers=2 --coverage.enabled=false -t carrier` | Recorded the expected Matrix warning failure before implementation. An earlier name-filtered run selected other tests and hit package-wide coverage thresholds. |
| Channels `npx --no-install vitest run test/matrix.test.ts test/matrix-bridges.test.ts test/matrix-native.test.ts test/matrix-crypto.test.ts test/matrix-send.test.ts --maxWorkers=2 --coverage.include=src/matrix.ts` | 112 passed, one existing skip. The changed Matrix reader achieved 100% statements, branches, functions and lines. |
| Channels `npx --no-install vitest run --maxWorkers=2` | 930 passed, one skip and 10 existing origin tests failed at loopback bind with `EPERM`. No external providers were used. |
| Daemon `npx --no-install vitest run --maxWorkers=2 --exclude test/cloud.test.ts --exclude test/css.test.ts` | Initial integration run surfaced the pinned export list and a CLI confirmation fixture that needed updating, plus runner failures for listen and child processes. |
| Daemon `npx --no-install vitest run --maxWorkers=2 --exclude test/cloud.test.ts --exclude test/css.test.ts --exclude test/production.test.ts -t '^(?!.*(hostile email/A2A\|the unchanged packaged binary\|asks before every launchd write)).*'` | Final offline package run passed, 185 passed and 3 filtered cases. An earlier run passed 182 with the same scope before the additional MIME cases. |
| Daemon `npx --no-install vitest run test/daemon.test.ts test/gate.test.ts test/gate-channels.test.ts test/gate-setup.test.ts test/exports.test.ts --maxWorkers=2` | 90 passed in the focused integration run before the last MIME regression was added. |
| Daemon `npx --no-install vitest run test/gate-setup.test.ts test/gate.test.ts --maxWorkers=2` after the final rebuild and typecheck | 7 passed, including CLI initialization, pinning and status, restart, and the compatibility probe. |
| Reference library only `npx --no-install tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` | Passed after a prebuilt linked artifact changed and the input runtime could no longer import its ledger module. Moved the old ignored dist aside before rebuilding. The compatibility probe passed again in the final daemon run. |
| Daemon and channels `pnpm run build`, `pnpm run typecheck`, `pnpm run lint` | Passed. Biome formatting checks were also applied to touched source and tests. |
| Root `pnpm run check:packages --mode policy @jeswr/agent-reference` | Passed using the offline dependency policy. |
| Root `pnpm run check:agent-layers`, `check:sdk-layers`, `check:rdf-discipline`, `check:app-duplication`, `check:codegen`, `check:lockfile-transport`, `git diff --check` | Passed. No layer allowlist or baseline edits. |
| Root `npx --no-install vitest run test/agent-layers.test.mjs test/agent-layers-reachability.test.mjs --maxWorkers=2` | 399 passed. Four subprocess fixtures returned empty stderr under both Vitest pools. Running the CLI on the same fixture inputs directly produced the expected exit code and diagnostic for all four. Re-running with those four filtered passed all 399 in-process cases. |
| Root `pnpm --filter @jeswr/app-agent-daemon list --prod --depth=0 --json` | Confirmed the new workspace edge after refreshing the worktree's ignored install metadata and linking the already built reference package. |
| `sh apps/agent-daemon/package-production.sh <fresh /tmp output>` with Turbo telemetry disabled | Passed. Pruned production workspace and frozen offline install included the reference runtime, reused 173 cached packages and downloaded zero. Plain Node imported the isolated app root and executed `node bin/awp.mjs gate --help`. Running the binary's normal and gate help directly in the workspace also passed. |

## Deviations and decisions

- The daemon preflights ingestion before invoking `importInbound`. Its existing
  `pullInbound` callback runs after an ACL write, so implementing the preflight in that callback
  would violate D6. The importer receives only a cached, filtered batch.
- The reference `accepted` disposition can mean it processed a refusal or challenge
  and prepared a reply. The daemon treats an `accepted` result with a reason as a refusal,
  preserving I1. The refusal code is reported without the reference detail. An indeterminate
  gate result aborts the batch, and an interrupted digest is a final operational refusal.
- Cross-carrier admission was compared on fresh receiver state for every channel. Within one
  live receiver, an identical signed message under different raw bytes is a runtime replay.
  Byte-identical raw retries reuse the recorded verdict.
- The daemon passes the Reader a BridgeMessage with a `gate` property so the existing
  gateway schema and positional API remain usable. Versions of private host compositions
  now need to supply the required port explicitly.
- The full workspace Turbo gates were skipped under the lane's focused-test and no
  reference full-build constraints. Loopback-dependent CSS, cloud, channel-origin and D-2
  cases could not complete in the sandbox. Two existing daemon tests also hit Vitest
  child-process restrictions. The production package and binary help were exercised directly.
- The worktree is uncommitted. The lane used local fixtures and an offline production package.

## Beads to file under P7.4

- `needs:jesse` Decide the canonical owner mandate and whether to sign the reference mandate
  with the owner's WebID key.
- `needs:jesse` Decide whether the pod vocabulary should represent the signed-message gate
  verdict independently of the unverified channel handle.
- Expose an explicit inbound admission verdict in the reference result for adapters that
  currently must interpret accepted protocol outcomes with reasons.
- Implement signed descriptions and configuration negotiation with BL-9 downgrade protection.
- Enforce per-sender rate limits before expensive checks.
- Add trust-register resolution beyond the operator's pinned list.
- Implement real A2A send carriage.
- Implement real MCP send carriage.
- Connect signed owner approval to staged memory writes.
- Define and install an explicit operation for free-text replies.

These are tracker filing notes. The tracker checkout is outside this worktree's write scope.

## Review fixes (41b)

| Finding | Change | Test that failed before the fix |
| --- | --- | --- |
| 1. Closing notice admission | `packages/agent-reference/src/runtime/agent.ts:5407` returns the admission refusal and reason before peer-close handling. Inbound results carry `admitted: true` only after a positive admission. `apps/agent-daemon/src/gate.ts:113` requires that signal. | `packages/agent-reference/test/inbound-closing.test.ts:8` observed an accepted disposition without the refusal reason. `apps/agent-daemon/test/gate.test.ts:72` observed a daemon admission for an accepted protocol result that lacked the admission signal. |
| 2. Matrix retry | `apps/agent-daemon/src/gate.ts:155` reads the stored raw-digest verdict before handling the carrier. An interrupted or refused verdict takes precedence. | Both cases at `apps/agent-daemon/test/gate-setup.test.ts:129` observed an unstructured result after a bridge hint suppressed the carrier on retry. |
| 3. MIME carrier size | `packages/agent-channels/src/email-mime.ts:140` reports the byte-cap failure. The MIME scan runs even when the legacy parser returns no carrier. `packages/agent-channels/src/email/mime.ts:191` lets that scan skip noncarrier bodies. A recovered signed carrier still goes through full MIME parity and reaches the gate. | `packages/agent-channels/test/email.test.ts:410` observed an unstructured observation for the sole oversized carrier. The recovered-carrier case at line 373 also observed `parity: none`. The plain mail compatibility case at line 387 failed during development when the strict MIME pass tried to decode all bodies. |
| 4. Key subjects | `packages/agent-reference/src/setup.ts:214` constructs each pin from the card identity and its declared key fields. `apps/agent-daemon/src/gate-setup.ts:139` rejects conflicting nested subjects before confirmation. | `packages/agent-reference/test/introduction.test.ts:7` observed a peer key bound to the local actor. `apps/agent-daemon/test/gate-setup.test.ts:97` observed that the daemon accepted a card with its own actor as the nested key subject. |
| 5. Account parity | `apps/agent-daemon/src/gate.ts:165` re-applies the current account's parity result before returning a cached admission. | `apps/agent-daemon/test/gate-channels.test.ts:264` observed an admission under a second account whose footer differed. |
| 6. Atomic pins | `apps/agent-daemon/src/gate-setup.ts:173` uses the private atomic writer. It syncs the temporary file, renames it and syncs the directory. | `apps/agent-daemon/test/gate-setup.test.ts:111` observed that an already-open descriptor read the replacement pins. It now reads the original file contents. |
| 7. Verdict durability | `apps/agent-daemon/src/gate.ts:62` keeps the synced checking marker in place while syncing the staged final verdict. It publishes the staged verdict with an atomic rename after the sync succeeds. | `apps/agent-daemon/test/gate-setup.test.ts:280` observed a cached admission on retry after the directory sync failed. It now checks refusal both immediately and after reopening. |
| 8. Ledger on lookup error | `apps/agent-daemon/src/gate.ts:209` commits a body-free indeterminate rejection when the ledger is writable. | `apps/agent-daemon/test/gate-setup.test.ts:173` observed no new ledger event for malformed verdict JSON. |

Existing admitted verdict files that predate explicit admission are reported as
`result-uncertain`. The regression at `apps/agent-daemon/test/gate-setup.test.ts:319`
first observed that an earlier admitted file bypassed this check. If a crash
loses the final verdict's promotion, the earlier durable checking marker
continues to refuse retries. A second account's parity refusal on a cached
admission leaves that matching admission available to the original account.

All commands used Node 24.22.3. Every Vitest run used `--maxWorkers=2`.

| Check | Result |
| --- | --- |
| Reference library build with `npx --no-install tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` | Passed. |
| Reference focused tests for the closing result, Introduction Card and settlement source admission | 5 passed. |
| Reference `test/oracle` alongside the focused tests, plus `test/traces.test.ts` separately | 8 passed in the combined run, including 3 oracle tests. All 15 trace tests passed. The manifest remains 283 / 278 / 0 / 5 and the committed manifest, traces and outlines match `fdbe7b471`. |
| Daemon build followed by the offline suite with the lane 41a filters | 194 passed, 3 filtered. The unfiltered run hit the existing loopback, child-process and packaging fixture limits. Both binary help commands passed when run directly. |
| Channels full suite | 933 passed, one existing skip and 10 origin tests blocked by `EPERM` on loopback bind. |
| Channels offline suite excluding the origin fixture file | 892 passed, one existing skip. |
| Channels MIME, golden-mail and Graph Mail send tests with coverage restricted to the two changed MIME files | 96 passed with 100% statements, branches, functions and lines. |
| Daemon and channels build, typecheck and lint, plus reference typecheck | Passed. |
| Root layer, RDF discipline, app duplication, codegen and lockfile transport checks | Passed. |

The worktree remains uncommitted. The lane used the reference library-only
build to preserve the committed artifacts. These fixes require no new tracker
items. The explicit inbound admission signal resolves the earlier follow-up
for adapters consuming the reference runtime's inbound result.

## Review fixes (41c)

| Finding | Change | Regression observed before the fix |
| --- | --- | --- |
| 1. Refused closing notice | `packages/agent-reference/src/runtime/agent.ts:5061` passes the proposed transition into admission. The handler saves it after admission at line 5422. A late peer notice also leaves the existing conversation untouched. | `packages/agent-reference/test/inbound-closing.test.ts:8` rejected the valid follow-up that a clean conversation admitted. The test also compares the complete conversation snapshot before and after the refusal. |
| 2. Verdict durability | `apps/agent-daemon/src/gate.ts:72` keeps a durable checking marker through the final rename and directory sync. Verdict reads treat a retained marker as interrupted. The gate syncs the marker removal before returning the final verdict. | `apps/agent-daemon/test/gate-setup.test.ts:280` returned an admission when the test injected a failure at the post-rename sync. The test now verifies the final file was visible at the injected failure and checks both immediate and reopened retries. |
| 3. Account parity | `apps/agent-daemon/src/gate.ts:178` stores parity refusals by raw digest and account hash. Cached admissions still apply the current account's parity result. Strict parser parity refusals use the same account key. | `apps/agent-daemon/test/gate-setup.test.ts:326` reopened the gate and observed that the first account's warning blocked the matching account. The regression also covers strict parser refusals and earlier shared verdict files. |
| 4. Matrix parser refusal | `apps/agent-daemon/src/daemon.ts:165` records a typed parser refusal through the gate using the original raw bytes. The gate consults that verdict before treating an observation as unstructured. | `apps/agent-daemon/test/daemon.test.ts:1413` observed a Reader call after a new daemon run presented the same malformed event with a Signal bridge hint. |
| 5. Plain HTML and cursors | `packages/agent-channels/src/email/mime.ts:147` scans HTML using legacy-compatible charset and transfer decoding. The scan skips unrelated bodies, keeps strict JSON-LD extraction, and uses strict MIME decoding for structured parity. `apps/agent-daemon/src/daemon.ts:170` fails the batch if the gate cannot record a parser refusal. | `packages/agent-channels/test/email.test.ts:410` threw during extraction of plain legacy HTML. The daemon tests at lines 1376 and 1549 observed that Latin-1 mail bypassed the Reader and that the cursor advanced without a recorded refusal. |

Pre-41c shared parity refusals cannot identify the account that produced them.
The gate rechecks a currently visible carrier. It returns `result-uncertain`
when the earlier parity refusal is the only remaining evidence of a carrier.
Embedded gates can implement `recordParseRefusal` to checkpoint parser refusals.
A host without that method can continue to handle parsed messages. A typed
parser refusal on that host holds the account cursor.

Node 24.22.3 was used throughout. Each Vitest invocation used `--maxWorkers=2`.

| Check | Result |
| --- | --- |
| Reference library-only build and typecheck | `npx --no-install tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` and `pnpm run typecheck` passed. |
| Reference closing, Introduction Card, settlement source admission and `test/oracle` | 8 passed. The separate trace suite passed all 15 tests. |
| Daemon and channels `pnpm run build`, `pnpm run typecheck` and `pnpm run lint` | Passed. |
| Daemon Vitest with the 41b offline filters | 201 passed, 3 filtered. The unfiltered run encountered the existing loopback, child-process and packaging fixture failures. |
| Channels Vitest | 938 passed, one existing skip. Ten origin tests were blocked by `EPERM` on loopback bind. The 41b offline run excluding the origins file passed 897 tests with one skip. |
| Channels MIME, golden-mail and Graph Mail send tests | 101 passed. Both changed MIME files reached 100% statements, branches, functions and lines. |
| Offline production packaging and binary smoke checks | The pruned workspace installed 173 cached packages with zero downloads. The isolated app entry point imported successfully. Both workspace help commands and packaged `gate --help` passed. |
| Root SDK and agent layers, RDF discipline, app duplication, codegen, lockfile transport and reference dependency policy | Passed. |
| Root agent-layer fixture suites with the lane 41a filters | 399 passed, 4 subprocess fixtures filtered. |

The reference manifest is 283 / 278 / 0 / 5. The manifest, traces, outlines and
oracle fixtures match `0825ae9f3` byte-for-byte. `git diff --check` passed.
The worktree is uncommitted. The lane used focused checks and the reference
library-only build.
