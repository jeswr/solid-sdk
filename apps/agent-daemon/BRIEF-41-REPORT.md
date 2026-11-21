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

## Review fixes (41d)

| Finding | Change | Regression observed before the fix |
| --- | --- | --- |
| 1. Matrix bridge hints | `packages/agent-channels/src/matrix.ts:90` identifies cleartext carriers before using bridge hints. Line 140 decodes native carriers on cleartext and decrypted events. An envelope parse failure reaches the daemon's refusal path. | `apps/agent-daemon/test/gate-setup.test.ts:361` observed `unstructured` on both hinted first delivery and hinted replay after admission. `apps/agent-daemon/test/daemon.test.ts:1549` observed a malformed carrier parse as plain text with a bridge hint. `packages/agent-channels/test/matrix-bridges.test.ts:228` observed a hint conflict prevent native parsing. |
| 2. Verdict commits | `apps/agent-daemon/src/gate.ts:80` requires a matching commit record. Line 95 syncs the verdict and prepared record before atomically publishing that record. | `apps/agent-daemon/test/gate-setup.test.ts:310` injected a directory sync failure and disabled further writes. The first check refused as indeterminate, but the retry returned an admission. The test now checks immediate and reopened retries. |
| 3. Cursor outcomes | `packages/agent-channels/src/graph-teams.ts:217` keeps messages in the batch for parsing and recording by the daemon. Pending cursor pages retain malformed and oversized rows. `packages/agent-channels/src/graph-mail.ts:159` holds the cursor if the provider's raw MIME cannot be read within bounds. | `apps/agent-daemon/test/daemon.test.ts:1466` found no Teams rejection in the gate ledger when the cursor was about to advance. `packages/agent-channels/test/graph-mail.test.ts:141` observed an advanced delta cursor after a raw MIME size refusal. |
| 4. Ordinary multipart mail | `packages/agent-channels/src/email/mime.ts:210` counts only carrier candidates during discovery. Structured parity still validates the full bounded MIME tree. | `apps/agent-daemon/test/daemon.test.ts:1416` sent a plain body with 13 attachments and observed no Reader call. The test now checks import, Reader classification and cursor advancement. |
| 5. Concurrent pins | `apps/agent-daemon/src/gate-setup.ts:176` takes a per-gate file lease after confirmation, rereads the trust store and validates the merged pins before replacing it. | `apps/agent-daemon/test/gate-setup.test.ts:129` synchronized two operator confirmations. Both writes returned success and only one peer's pins survived. |
| 6. Refusal reason | `packages/agent-channels/src/email-mime.ts:197` and `packages/agent-channels/src/graph-teams/card.ts:46` attach `conflicting-structured-copies` to the typed parse refusal. `apps/agent-daemon/src/daemon.ts:168` records that reason with the raw digest. | `apps/agent-daemon/test/daemon.test.ts:1466` observed `malformed` in the durable MIME record. Both MIME and Teams now assert the exact reason before the checkpoint write. |

Earlier verdict files lack commit records and appear as `result-uncertain` on
replay, including old shared parity refusals. Current parity refusals remain
account-scoped. The verdict and prepared record are synced before the commit
record is published. If a crash loses that final directory entry, the digest
is held as interrupted.

Node 24.22.3 was used throughout. Each Vitest invocation used `--maxWorkers=2`.

| Check | Result |
| --- | --- |
| Reference library-only build and typecheck | `npx --no-install tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` and `pnpm run typecheck` passed. |
| Reference closing, Introduction Card, x402 settlement and `test/oracle` | 12 passed. The separate trace suite passed all 15 tests. |
| Daemon and channels `pnpm run build`, `pnpm run typecheck` and `pnpm run lint` | Passed. |
| Daemon Vitest with the 41c offline filters | 208 passed and 3 filtered. The unfiltered run passed 208 and encountered 20 failures in the loopback, cloud, subprocess and production fixtures. |
| Channels Vitest | 933 passed and one existing skip. Ten origin tests hit `EPERM` on loopback bind. The offline run excluding `test/origins.test.ts` passed 892 with one skip. |
| Focused channels coverage | 300 passed with one skip. Both MIME files, Matrix, Graph Mail, and the Teams reader, card and REST files reached 100% statements, branches, functions and lines. |
| Offline production packaging and binary smoke checks | The pruned workspace installed 173 cached packages with zero downloads. The final run used pnpm's hardlink import mode to fit the sandbox disk quota. The isolated app entry point imported successfully. Both workspace help commands and packaged `gate --help` passed. |
| Root SDK and agent layers, RDF discipline, app duplication, codegen, lockfile transport and reference dependency policy | Passed. |
| Root agent-layer fixture suites with the 41c filters | 399 passed and 4 subprocess fixtures filtered. |

The reference manifest is 283 / 278 / 0 / 5. The manifest, traces, outlines and
oracle fixtures match `0825ae9f3` byte-for-byte. `git diff --check` passed.
The worktree is uncommitted.

## Review fixes (41e)

| Finding | Change | Regression observed before the fix |
| --- | --- | --- |
| 1. Verdict durability | `apps/agent-daemon/src/gate.ts:99` syncs the directory after the final `.commit` rename. A failed sync attempts to remove the commit record so the verdict remains interrupted. | `apps/agent-daemon/test/gate-setup.test.ts:335` observed admission with no directory sync after the commit file appeared. The test now covers admitted, unstructured and refused verdicts. The failure-injection test checks immediate and reopened retries. |
| 2. Ordinary HTML attachments | `packages/agent-channels/src/email-mime.ts:119` counts JSON-LD MIME leaves and HTML leaves with a JSON-LD script during discovery. Full MIME parity still applies to signed messages. | `apps/agent-daemon/test/daemon.test.ts:1419` observed no Reader call for a plain message with 13 ordinary HTML attachments and zero carriers. It now verifies import, classification and checkpointing. |
| 3. Oversized Graph Mail | `packages/agent-channels/src/graph-mail.ts:166` returns a `bounds-exceeded` refusal and continues the delta page. Refusals carry the MIME digest when available. If the guard withholds the bytes, the digest identifies the binding, account and provider item ID. | `packages/agent-channels/test/graph-mail.test.ts:138` observed `list()` fail on the oversized MIME before returning the next valid item. Transport cap tests also cover declared and streamed refusals. |
| 4. Oversized Teams rows | `packages/agent-channels/src/graph-teams.ts:44` stores oversized pending rows as an ID, digest and refusal reason. `apps/agent-daemon/src/daemon.ts:158` records both bindings' refusals through the gate before checkpointing. | `packages/agent-channels/test/graph-teams.test.ts:123` observed `invalid Teams JSON` when six oversized rows inflated the cursor beyond 1 MiB. The test resumes from the compact cursor and parses the later valid row. The daemon test at line 1552 verifies the ledger before checkpointing. |
| 5. Failed pin lease acquisition | `apps/agent-daemon/src/local.ts:66` closes and removes the newly created lock when acquisition fails. | `apps/agent-daemon/test/gate-setup.test.ts:129` observed `pin.lock` survive a forced sync failure. It now verifies a subsequent pin succeeds. |

The review's upgrade and old shared parity findings remain as requested. Existing
read behavior for verdicts written by earlier unreleased commits is unchanged.
No new tracker items were identified.

Checks used Node 24.22.3 and Vitest with `--maxWorkers=2`.

| Check | Result |
| --- | --- |
| Daemon Vitest | The lane 41d offline filters passed 215 tests with 3 filtered. The unfiltered run passed 215 and hit 20 failures in the loopback, cloud, subprocess and production fixtures. |
| Channels Vitest | 936 passed, one existing skip and 10 origin tests blocked by `EPERM` on loopback bind. The offline run excluding `test/origins.test.ts` passed 895 tests with one skip. |
| Lane 41d focused channels coverage, including Graph Mail REST | 303 passed with one skip. The eight files measured reached 100% statements, branches, functions and lines. |
| Reference library-only build and typecheck | `npx --no-install tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` and `pnpm run typecheck` passed. |
| Reference closing, Introduction Card, x402 settlement and `test/oracle` | 12 passed. The separate trace suite passed all 15 tests. |
| Daemon and channels `pnpm run build`, `pnpm run typecheck` and `pnpm run lint` | Passed. |
| Offline production packaging and binary smoke checks | The pruned workspace installed 173 cached packages with zero downloads using pnpm's hardlink mode. Both workspace help commands, packaged `gate --help` and a plain Node import of the isolated app entry point passed. |
| Root SDK and agent layers, RDF discipline, app duplication, codegen, lockfile transport and reference dependency policy | Passed. |
| Root agent-layer fixture suites with the lane 41d filters | 399 passed and 4 subprocess fixtures filtered. |

The reference manifest is 283 / 278 / 0 / 5. The manifest, traces, outlines and
oracle fixtures match `0825ae9f3` byte-for-byte. `git diff --check` passed. The
worktree is uncommitted.

## Review fixes (41f)

- Graph Mail preserves the saved cursor on non-2xx MIME fetches. The regression
  reproduced checkpoint advancement on oversized 503s with both declared and
  streamed bodies, through both guard layers. The retry now returns the unread
  item. Teams already propagates collection transport failures.
- The gate requires a digest-matched confirmation written after the commit
  directory sync. The regression reproduced cached admission when sync and
  cleanup both failed. Immediate and reopened retries now return
  `result-uncertain`. Earlier verdict formats remain readable as interrupted
  when they lack confirmation.

The requested Vitest runs passed 942 channel tests and 216 daemon tests.
Ten channel loopback fixtures and 20 daemon loopback, subprocess and packaging
fixtures failed in the sandbox. Both offline subsets passed, and Graph Mail
reached 100% coverage in its focused run. Biome and both project typechecks
passed. The offline full workspace gate stopped at missing dependencies in
`@jeswr/solid-webauthn-reauth`.

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

## Phase 2 (41g)

The Proposer's `memory_recall` uses durable gate facts and owner-scoped PKG
recall. The host supplies its purpose IRI and the owner memory's verified
mandate loader. The daemon installs the gateway callback and provisions
`memory/` and `memory/pending/` under the inherited workspace ACL.

### Files changed

- `packages/agent-reference/src/runtime/agent.ts` shares the existing task
  admission filter between `admittedStatements()` and the new detached
  `admittedFacts()` read. `test/admitted-facts.test.ts` covers the filter and
  detached provenance.
- `apps/agent-daemon/src/gate.ts` exposes the facts from the gate under its
  existing lease. Optional trusted admission configuration supplies a named
  reference task, reliance rules and operation handlers. Phase 1 initialized
  the reference runtime with an empty handler list and no reliance rules.
- `src/memory.ts`, `src/daemon.ts`, `src/types.ts` and `src/index.ts` implement
  and expose bounded runtime recall. `src/workspace.ts` provisions both
  containers. `src/testing.ts` composes the real agent-memory recall with a
  memory pod and an in-memory approval queue for offline tests.
- `package.json` and `pnpm-lock.yaml` add the existing agent-memory workspace
  dependency. The daemon README, SKILL and this report document composition.
  `packages/agent-model-gateway/README.md` shows the direct gateway callback.
- Daemon `test/memory.test.ts`, `test/daemon.test.ts`, `test/workspace.test.ts`
  and `test/exports.test.ts` cover the recall path. The composition, CSS,
  polling-executor and gate fixtures and the D-2 demo use the new interfaces.

### Red and green checks

| Case | Before the change | After the change |
| --- | --- | --- |
| Reference facts | `TypeError: runtime.admittedFacts is not a function`. | The current task's admitted statement and provenance are returned as a detached copy. Rejected, stale and other-task entries are excluded. |
| 1. Signed statement through the Proposer tool | `expected [] to match object { items: [...], withheld: +0 }` with a configured reference fixture. | The actual gateway tool returns the statement, source, time, method, digest, terms and purpose. |
| 2. Bad signature, issuer without a source rule, plain observation | The signature case hit `reopened.facts is not a function`. The other two tool calls returned the bare Phase 1 `[]`. | The signature refusal never calls the Proposer, and the reopened gate has zero facts. The other two return an empty recall result, including for owner-flagged plain text. |
| 3. Purpose and supersession | `Cannot find module '/src/memory.js'`. | A mocked superseded fact and a fact for a different purpose contribute to the withheld count. |
| 4. Literal model input and bounds | `Cannot find module '/src/memory.js'`. | Literal wildcard, foreign IRI and 4096-character queries keep the owner request fixed. Case folding, newest-first order, ID ties and UTF-8 byte and item limits pass. |
| 5. Owner memory | `Cannot find module '/src/memory.js'`. | A signed approval and real SHACL validation make the preference recallable with all four graphs. Pending content and provenance-only matches are excluded. |
| 6. Restart | `TypeError: gate.facts is not a function` after the real gate admitted the signed message. | Closing and reopening the same gate directory recovers the same statement and provenance through recall. |
| 7. Workspace privacy | `expected -1 to be greater than 1` because the memory create request was absent. | The owner-only ACL precedes both container creates and content writes. |
| 8. Composition | `TS2578: Unused '@ts-expect-error' directive`. | The test project typechecks with the expected error on the old host field. |

### Follow-up

The initial tests covered restart with one fact, signature refusal, missing
source authority and plain observations. The 41h review below covers post-admission
refusal, missing purpose and terms, repeated statement IDs, real precedence and
pre-existing ACLs. The model's only input is the substring. The trusted purpose
and `limit: 50` are the only inputs to owner recall. The output defaults to 20
items and 64 KiB of JSON.

Pairing signed owner approvals with staged remember proposals and calling
`approveRemember` is the owner-memory write-path follow-up already tracked
in `sst-ans.31`.

### Verification

Checks used Node 24.22.3 and Vitest with `--maxWorkers=2`.

| Check | Result |
| --- | --- |
| Reference library-only build | `npx --no-install tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` passed. |
| Reference tests | All four tests passed across `admitted-facts`, `oracle` and `oracle-snapshot`. Git status for `traces`, `outlines` and `scenario-runs.json` was empty. |
| Daemon typechecks | Both the source and test projects passed. |
| Daemon full Vitest | 225 passed and 20 failed. CSS and the D-2 demo hit `listen EPERM`. Fifteen cloud cases timed out during loopback setup. The host plist case hit `spawnSync python3 EPERM`. The packaged CLI and production fixtures received empty child stdout. |
| Daemon offline Vitest | 225 passed with three cases filtered. The cloud, CSS and production fixture files were excluded. |
| Direct offline packaging | The pruned workspace installed 177 cached packages with zero downloads. The packaged runtime-memory export, recall fixture and CLI help passed under plain Node. |
| Biome and root guards | Biome exited successfully with existing warnings in the reference runtime. SDK and agent layers, RDF discipline, app duplication and `git diff --check` passed. |

Changes are in the working tree.

## Phase 2 review fixes (41h)

| Finding | Regression before the fix | Guarantee after the fix |
| --- | --- | --- |
| M5 | An operation handler refused a signed invocation after its statement entered task context. The refused statement was recallable. | The daemon correlates each fact with its delivery and requires that delivery's confirmed, durable `admitted` verdict. Refused or unconfirmed deliveries and legacy facts without that link are excluded before and after reopening the gate. |
| M2 / CORE-IN-11 | A signed invocation without a purpose or terms returned the statement. A scoped statement without terms lacked terms in provenance. | A fact admitted without a purpose is interaction-scoped and contributes to the withheld count for every host purpose. Every returned fact includes effective terms, including the default of interaction-only use, no onward sharing and deletion at the end of the interaction. |
| M1 | Copying a pending TriG directly into `memory/` exposed it to recall. | Promotion saves the signed owner approval beside the TriG after SHACL validation and before deleting pending. Recall requires a valid, unexpired approve decision from the owner for the exact bytes and destination, plus the verified mandate scope. Pending and unsigned legacy resources are excluded. A changed owner key or changed resource bytes invalidates the stored evidence. |
| M4 | After receiving versions A, B and A again under one statement ID, restart restored B and its purpose. | Accepted context revisions retain their admission order. Reopening the gate restores the last admitted revision and its provenance labels for that task. |
| Precedence | A real precedence decision hid the superseded statement with `withheld: 0`. | A superseded fact with a confirmed admission contributes to `withheld` independently of the query. The tool returns only the current eligible fact. |
| Workspace privacy | Both existing container ACLs retained another agent's grant. | Initialization writes an owner-only access and default ACL on both `memory/` and `memory/pending/`, replacing existing container ACLs before workspace content is written. Descendants inherit the default when they have no ACL of their own. |

Each regression failed against the original code and passed with the fix. The
daemon tests use signed invocations and reopen the same gate directory. The owner
memory test also checks an incorrect verifier key, an expired approval and a
UTF-8 BOM added to the approved TriG. The ACL test parses the ACLs on
two pre-existing containers and checks their grants and inheritance targets.

### Verification

| Check | Result |
| --- | --- |
| Reference library build, admitted-facts and both oracle suites | Passed. Four tests across three files. The Git diff for traces, outlines and `scenario-runs.json` is empty. |
| Agent memory | All 58 offline tests and both TypeScript projects passed. The full suite could not start its CSS fixture because the sandbox denied loopback listen. |
| Daemon | Source and test typechecks passed. Full Vitest passed 231 and failed 20. CSS and the D-2 demo hit loopback `EPERM`. Fifteen cloud tests timed out during loopback setup. The plist test hit Python spawn `EPERM`, and the two packaged checks received empty child stdout. The offline run passed 231, with three cases skipped by the test-name filter. |
| Biome and root guards | Biome passed with existing reference warnings. SDK layers, RDF discipline, app duplication, agent layers and `git diff --check` passed. |

<!-- AUTHORED-BY Codex GPT-6 -->

## Phase 2 review fixes, round 2 (41i)

| Finding | Before | After |
| --- | --- | --- |
| Interaction-only recall | A signed fact with a declared purpose and default terms appeared in recall, including after reopening. The check expected two withheld facts and got one. | Runtime recall counts facts with an absent or different admitted purpose and facts with interaction-only default terms as withheld. The signed gate test checks a purpose-less admission, a matching-purpose admission without supplier terms, and an eligible admission with supplier terms, both live and after reopening. The purpose-less fact retains its absent purpose. |
| Refused revision | After a refusal, recall returned an empty list for a statement with a prior confirmed admission. Changed and identical statement bytes reproduced this live and after reopening. | The gate retains distinct delivery receipts for identical statement bytes and supplies its confirmed receipts to the fact reader before the reader selects the latest eligible revision. The test checks the admitted statement, terms, purpose and provenance. A prior receipt already overwritten by an older build cannot be recovered from its saved context. |
| Precedence trace | Restoring two equivalent winning statements across tasks named the second task's statement in the supersession trace. | The first occurrence of each statement ID keeps its position from context iteration. Admission sequence selects among revisions of that ID when both revisions have a sequence. Both numbered and legacy-order fixtures keep the previous winner. |
| Owner-memory SHACL | Recall returned an exact signed copy of a resource that promotion rejected under SHACL. | The two paths validate the full dataset using the same shapes, validator and proposal base IRI. Recall skips nonconforming resources and rechecks approval expiry after validation. The real SHACL regression proves the exact copy is recallable under the conforming shape and withheld under the rejecting shape. |

The tracked confirmation-rename, directory-sync and cleanup failure remains a
separate issue.

| Check | Result |
| --- | --- |
| Reference build and Vitest | Library-only TypeScript build, generated asset copy and typecheck passed. All 18 tests passed across admitted-facts, claim-failures and both oracle files. |
| Targeted scenarios | `mortgage-core` ran two paths and `pay-an-invoice` ran three. The five trace diffs contained only `generated.commit` changes. Both manifests differed only in row order. The worktree index was read-only, so `git checkout-index` restored the generated files after `git checkout` could not acquire its index lock. Git reports an empty diff for traces, outlines and `scenario-runs.json`. |
| Agent memory | Both TypeScript projects and all 59 offline tests passed. The CSS suite could not bind loopback in the sandbox. |
| Daemon | Both TypeScript projects passed. Full Vitest passed 233 tests and reported 20 failures in loopback and subprocess fixtures. CSS and the D-2 demo hit `listen EPERM`, 15 cloud tests timed out during loopback setup, Python plist validation hit `spawnSync EPERM`, and the two packaged-binary checks received empty child stdout. The offline Vitest run passed 233 with three cases skipped by the test-name filter. A direct production package installed 177 cached dependencies and its CLI help ran successfully. |
| Biome and root guards | Biome passed with warnings. `pnpm run lint:root` and `git diff --check` passed. |

<!-- AUTHORED-BY Codex GPT-6 -->

## Phase 2 review fixes, round 3 (41j)

| Finding | Before | After |
| --- | --- | --- |
| Derived recall with interaction-only inputs | A signed, matching-purpose derived claim appeared in recall live and after restart. The count was one for the direct input alone. | Runtime recall applies one effective-terms check per fact. It follows inherited terms and the recorded input IDs and digests recursively. A withheld or unavailable input also withholds the derived fact. The same regression now returns zero items and a count of two. The supplier-terms control remains recallable. |
| Refused precedence successor | The gate recorded a supersession before refusing the winner. Recall withheld the earlier confirmed fact live and after restart. An earlier admitted revision of the winner's ID also masked this problem in the partial fix. | The confirmed-receipt read checks the gate's current or held successor for the same precedence group. When that successor's delivery lacks a confirmed admission, recall returns the earlier fact without the supersession marker. The regressions cover both a new successor ID and a refused revision of a previously admitted ID. |

The signed gate regressions failed before the fixes and passed both live and after
reopening the same directory. Unit tests also cover nested inherited default
terms and transitive withholding for superseded inputs, inputs admitted for a
different purpose, and inputs replaced under the same ID. Gate recording,
derivation, and mixed legacy revision ordering retain their existing behavior.

| Check | Result |
| --- | --- |
| Reference | Library-only TypeScript build, generated asset copy and typecheck passed. All 18 tests passed across admitted-facts, claim-failures and both oracle files. |
| Targeted scenarios | `mortgage-core` ran two paths and `pay-an-invoice` ran three. The five traces differed only at `generated.commit`. The trace index and scenario manifest differed only in row order. `git checkout-index` restored the generated artifacts, and the trace, outline and manifest paths are clean. |
| Agent memory | Both TypeScript projects and 59 offline tests passed. The full run reached the sandbox's loopback `EPERM` in the CSS fixture. |
| Daemon | Both TypeScript projects and the build passed. The offline Vitest run passed 239 tests, with three skipped by the name filter. Full Vitest passed 239 tests and reported the same 20 sandbox failures as 41i in loopback and subprocess fixtures. Direct production packaging installed 177 cached dependencies with zero downloads. Plain Node imported the packaged daemon and ran `awp gate --help`. The temporary package directory was removed. |
| Biome and root guards | Biome passed with existing reference warnings. `pnpm run lint:root` and `git diff --check` passed. |

<!-- AUTHORED-BY Codex GPT-6 -->

## Phase 2 review fixes, round 4 (41k)

Workspace initialization uses the storage client's parsed HEAD links to find the
WAC ACLs for `agent/`, `agent/memory/` and `agent/memory/pending/`. It writes
owner-only access and inheritance grants to each advertised document. An absent,
ambiguous or out-of-scope link stops initialization before type-index registration.
The existing storage scope applies to the discovered URL.

The HTTP regression seeds an extra third-party grant in all three advertised
ACLs. Before the fix, the alternate ACL still contained that WebID after
initialization. The two missing-link cases and the foreign-origin case also
resolved successfully. With the fix, the advertised documents contain only the
owner's grants and all three invalid-link cases reject before any write to the
unusable ACL destination or the type index.

| Check | Result |
| --- | --- |
| Daemon typecheck, build and offline Vitest | Passed. The offline run passed 243 tests with three cases skipped by the test-name filter. |
| Full daemon Vitest | 243 passed and 20 failed, matching the sandbox failure set from 41i. CSS and the D-2 demo hit `listen EPERM`. Fifteen cloud cases timed out during loopback setup. The launchd case hit `spawnSync python3 EPERM`, and the CLI and production dependency checks received empty subprocess stdout. |
| Reference | The library-only build passed, and all 18 admitted-facts, claim-failures and oracle tests passed. |
| Targeted scenarios | `mortgage-core` ran two paths and `pay-an-invoice` ran three. The five traces differed only at `generated.commit`. The trace index and scenario manifest differed only in row order. All generated trace, outline and manifest files were restored. |
| Production package | The frozen offline install reused 177 cached dependencies with zero downloads. Plain Node imported the packaged daemon and ran `awp gate --help`. The temporary package directory was removed. |
| Biome and root guards | Biome on changed TypeScript files, `pnpm run lint:root` and `git diff --check` passed. |

<!-- AUTHORED-BY Codex GPT-6 -->

## Phase 2 review fixes, round 5 (41l)

Workspace initialization rejects ACL URLs already claimed by another
container or reserved for workspace writes. The shared-link regression checks
that the first ACL keeps its grants and startup stops before registration.

When the private type index is missing, the daemon conditionally creates an
empty document. It discovers the index's own `rel="acl"` link with the same
checks used for containers, writes the owner-only ACL, then adds the
registration using the index's ETag. An empty index left by a failed attempt
must pass ACL discovery and protection on restart as well. The regressions
verify the write order with a nonstandard ACL URL and check that unusable links
leave the index empty across attempts.

The in-memory pod fixture now advertises ACL links for documents and models
the Solid backend's exact PUT behavior for named creates.

| Check | Result |
| --- | --- |
| Daemon typecheck and Biome | Both TypeScript projects and Biome on the changed TypeScript files passed. `git diff --check` passed. |
| Offline daemon Vitest | 256 passed. Four cases were skipped by name, and the cloud and CSS files were excluded. |
| Full daemon Vitest | `npx vitest run --maxWorkers=2` passed 256 and reported the same 20 sandbox failures as 41k. CSS and D-2 hit `listen EPERM`, 15 cloud cases timed out in loopback setup, launchd hit `spawnSync python3 EPERM`, and the two packaging checks received empty subprocess stdout. |

<!-- AUTHORED-BY Codex GPT-6 -->

## Phase 3 (41m)

The daemon releases proposal messages through the leased reference runtime. The
executor retains its existing dispatch checks and provider access. The current
reference runtime emits signed JSON-LD packets by default, so this phase adds an
explicit compact JWS option to `sendMessage` for the existing W17 carrier. The
runtime signs inside the existing checked release path.

### Files changed

- `apps/agent-daemon/src/gate.ts`, `outbound.ts`, and `index.ts` expose the outbound
  mapping and lease-bound release and verification. Private release receipts
  bind a proposal to the exact bytes in the reference outbox. Retrying a complete
  release reuses those bytes. An interrupted release refuses a retry of that
  proposal.
- `apps/agent-daemon/src/cli.ts` adds `awp gate mandate <mandate.jws>`. It holds the
  daemon process lease and installs the supplied file only after the runtime
  verifies the pinned owner proof, subject, validity and revocation status.
- `apps/agent-daemon/src/daemon.ts`, `types.ts`, and `proposal-results.ts` replace
  `proposalWritten` with `project`, durably cache typed refusals and audit them
  without publishing pending proposals. The composition, CSS, polling-executor
  and D-2 fixtures adopt the renamed option.
- `packages/agent-executor/src/projector.ts` and `index.ts` add the projector and
  typed refusal. It renders through the selected send binding and commits the
  exact wire, trusted account, intent and gate-produced preview to approval.
  The executor's export contract and projector tests cover the new API.
- `packages/agent-reference/src/runtime/agent.ts` adds compact signing for an
  explicitly authorised follow-up. The option checks that the authorised
  recipient matches the conversation's peer and holds compact releases in a
  conversation awaiting the principal.
- `apps/agent-daemon/README.md` documents host wiring, mandate installation and
  the approval and limits timing. `test/outbound.test.ts` and `test/daemon.test.ts`
  cover the integration and refusal cache.

### Red and green checks

| Added cases | Initial failing output | Passing result |
| --- | --- | --- |
| Right-key and foreign-key JWS without a release | `TypeError: f.gate.verifyOwn is not a function` | The real direct send half rejects both at render and transmit. A new own-key signature reusing a released ID also fails verification. |
| Missing mapping, recipient outside the allowed set and deny-all | `TypeError: f.gate.release is not a function` | `unsupported-operation`, `ask-principal` and the deny-by-default mandate reason respectively, before outbox insertion or executor approval lookup. |
| One approved send and peer admission, code-rendered preview, and invalidated approval after one changed term | `TypeError: gate.release is not a function` | The release survives restart with identical bytes. A verified owner approval permits one direct send, and the peer runtime admits the mailbox bytes. The preview excludes the model instruction. Changing only the approval-bound expiry prevents dispatch with the old approval. |
| Pinned-owner mandate installation | `TypeError: installGateMandate is not a function` | A foreign owner's signature leaves the old file in place. The CLI refuses a held process lease and installs the pinned owner's signed file after the lease is free. |
| Refusal cache and audit replay | `TypeError: ProposalRefusedError is not a constructor` | A repeated batch projects once, retains one refusal and audits it once without writing a pending resource. |
| Projector success, typed refusal, missing binding and missing account | `TypeError: createOutboxProjector is not a function` | A successful projection binds the preview, wire and account. Refusals and missing configuration stop before rendering. |

### Invariants and follow-up

- O1. The direct binding verifies the gate signature and exact released bytes
  before rendering or dispatch. Host composition supplies the same gate
  verifier to every send half.
- O2. The reference runtime checks the mapped intent and message before signing.
  The executor's nine-step gate independently checks the VC mandate, control
  state, exact approval, limits and wire at dispatch.
- O3. The gate renders the preview from the released message and its authorised
  operation and purpose. Approval binds the preview and the exact carrier.
- O4. The daemon treats `ask-principal` as a refusal and cannot approve on behalf
  of the owner.
- O5. A missing mapping and the deny-all mandate prevent new releases.
- The executor decides approval and limits after sealing and records them in
  agent-audit. Phase 4 links the verdicts to the reference ledger. The orchestrator
  owns the bead. Signing a reference mandate remains the owner's act.

### Verification

| Check | Result |
| --- | --- |
| Reference library-only rebuild and requested suites | All four suites passed, 18 tests. Git status for `traces/`, `outlines/` and `scenario-runs.json` was empty. |
| Daemon source and test TypeScript checks | Passed. |
| Full daemon Vitest | 266 passed and 20 sandbox failures. CSS and D-2 hit `listen EPERM`. Fifteen cloud tests timed out in loopback setup. Launchd hit `spawnSync python3 EPERM`. The packaged CLI and dependency graph checks received empty subprocess stdout. |
| Daemon Vitest without sandbox-dependent cases | 266 passed. |
| Executor Vitest with V8 coverage | 576 accessible tests passed and per-file thresholds passed at 100% statements, branches, functions and lines. The four process-death cases timed out waiting for a child. A direct subprocess probe returned `EPERM`. |
| Biome and repository guards | Biome exited successfully with existing warnings and infos in the reference runtime. SDK layers, agent layers, RDF discipline, app duplication and `git diff --check` passed. |

## Phase 3 review fixes (41n)

- The daemon binds each release receipt to the digest of the active reference
  mandate. A retry under the same active mandate can reuse the wire. A replacement
  mandate or a legacy receipt without a digest sends the proposal through the
  runtime again. Verification rejects an existing envelope whose receipt carries
  an inactive or missing mandate digest, including before a retry updates the receipt.
- The projector and executor pass the expected proposal ID and conversation
  through the send interface. Each concrete send half forwards them to its
  verifier, including when it rechecks the carrier at dispatch. The daemon README
  describes how host wrappers pass the same context through validation.
- The outbound gate builds the approval preview solely from the signed message,
  omitting absent fields. The executor binds the resulting preview and wire to
  the approval digest.
- The reference runtime shares its mandate validity check with the CLI installer.
  The installer preserves the installed file when a pinned owner's replacement
  is expired or future-dated.

### Red and green checks

| Regression | Initial failing output | Passing result |
| --- | --- | --- |
| Retry after installing a deny-all mandate | Expected `ok: false`, received `ok: true`. | Verification rejects the old envelope before retry. The runtime denies the retry and the projector creates no executor entry. |
| Verify an envelope for another proposal or conversation | The verification promise resolved instead of rejecting. | Verify, project and direct transmit reject both mismatches. Verification succeeds for the original proposal and conversation. |
| Omit unsigned delivery purpose from preview | Expected no `purpose` property, received the mapped scheduling purpose. | The preview omits `purpose`; the signed operation and delivery terms remain visible. |
| Install expired and future-dated owner mandates | Both cases returned CLI status 0 instead of 1. | Both return status 1 and preserve the installed bytes. A mandate starting at the current time installs successfully. |

### Verification

| Check | Result |
| --- | --- |
| Outbound integration | 14 passed, including the four review regressions and both invalid date cases. |
| TypeScript | Reference library-only rebuild and generated asset copy passed. Channels, executor and daemon source builds and test typechecks passed. |
| Reference Vitest and traces | All 18 tests passed across admitted-facts, claim-failures and both oracle suites. Git status for `traces/`, `outlines/` and `scenario-runs.json` was empty. |
| Daemon Vitest | 271 passed in both runs. The full run reported 20 sandbox failures. CSS and D-2 hit `listen EPERM`, 15 cloud tests timed out in loopback setup, launchd hit `spawnSync python3 EPERM`, and two packaging checks received empty subprocess stdout. |
| Executor Vitest with V8 coverage | 576 passed and all four metrics met 100% per-file thresholds. Four process-death cases in the full run timed out waiting for a child. A direct subprocess probe returned `EPERM`. |
| Channel Vitest | 942 passed in the local run. Ten loopback cases in the full run hit `listen EPERM`; one existing skip remained. |
| Biome and repository guards | Biome passed with existing reference warnings and infos. SDK layers, agent layers, RDF discipline, app duplication and `git diff --check` passed. |

## Phase 4 (41o)

### Changes

| Location | Change |
| --- | --- |
| `packages/agent-audit/src/records.ts:86`, `:136`, `:212` and `packages/agent-audit/src/index.ts:20` | Added closed schemas for `gate-decision` and `record-anchor`. The 4 KiB compact JWS field admits only the self-witness header and payload, with identities and head bound to the row. Sealing rejects an anchor if the predecessor has moved. |
| `packages/agent-audit/src/prov.ts:51`, `packages/agent-model/src/vocab.ts:18` and `packages/agent-model/docs/vocab.ttl:486` | Projected the gate and sealed head coordinates through the wrapper-backed PROV writer. The canonical record projection carries the remaining fields. |
| `packages/agent-audit/src/verify.ts:76`, `:167` and `packages/agent-audit/src/reader.ts:66` | Verify the referenced sequence and hash against supplied gate evidence. Check retained history against independently witnessed points and require each anchor to follow the head it names. The pod reader accepts the same evidence options. |
| `packages/agent-audit/src/file-ledger.ts:87` and `packages/agent-audit/src/stats.ts:126` | Kept the anchor adjacent to the signed predecessor at a rotation boundary. Excluded these integrity records from task instrumentation counts. |
| `apps/agent-daemon/src/gate.ts:69`, `:301`, `:319`, `:334` and `:525` | Recorded a reference event for local and cached outbound verdicts, and exposed the reference head and EdDSA witness to the leased daemon. A failed reference write aborts the batch. Restricted the new audit reasons to reference and gate codes. |
| `apps/agent-daemon/src/daemon.ts:169`, `:222`, `:263`, `:421`, `:517` and `:629` | Wrote inbound evidence before import or model calls, including parser refusals. Wrote outbound evidence before handing a release to the projector. Verified and sealed moved audit heads at heartbeat and after executor drain. An intervening writer invalidates a stale anchor and triggers a fresh witness. Authority polling continues during anchor I/O. |
| `apps/agent-daemon/src/types.ts:40`, `:59`, `apps/agent-daemon/src/instrumentation.ts:44` and `apps/agent-daemon/README.md:203` | The host passes the daemon's audited signer to `createOutboxProjector`. Binding and account preflight stay ahead of release. The task recorder continues to accept the instrumentation kinds. |
| `apps/agent-daemon/src/cli.ts:114`, `:196` and `apps/agent-daemon/README.md:240` | Added `awp audit --ledger <events.jsonl>`. It checks the paired local chains, finds missing gate links, verifies retained anchor JWS signatures against the configured gate public key and compares the audit ledger against heads witnessed in the gate ledger. |
| `apps/suite/src/apps/agent/lib/audit.ts:32` and `apps/suite/src/apps/agent/components/activity.tsx:70`, `:391` | Activity shows “Checked a message” and “Record sealed” with record details under Advanced. The reader uses the shared schema and exact PROV projection. |
| `apps/agent-daemon/src/testing.ts:17`, `test/record-port.ts:7`, `test/daemon.test.ts:184`, `test/gate.test.ts:76`, `test/composition.test.ts:54`, `test/polling-executor.test.ts:144`, `test/css.test.ts:300` and `demos/d2-spending-limits.test.ts:282` | Updated simulated hosts to expose record capabilities and use the audited signing callback. Existing ledger and statistics fixtures distinguish instrumentation kinds from the new kinds that have required fields. See `packages/agent-audit/test/ledger.test.ts:37`, `test/mirror.test.ts:65` and `test/stats.test.ts:17`. |

### Failing tests and passing results

| Case | Failure on the Phase 3 baseline | Passing Phase 4 behavior |
| --- | --- | --- |
| Audit schemas and gate ledger link, `packages/agent-audit/test/verify.test.ts:287` | All seven accept cases, all twelve paired accept/reject cases and the gate-link case reached the old schema rejection. | Required fields, qualified outcomes and the receipt shape are accepted. The invalid variants fail. A missing or mismatched gate sequence and hash is reported. |
| Mirror round trip, `packages/agent-audit/test/mirror.test.ts:456` | The first append rejected `gate-decision` as an unknown kind. | `test/fixtures/gate-decision.ttl` and `test/fixtures/record-anchor.ttl` match the mirrored graphs. Exact round trip succeeds and supplying missing gate evidence fails. |
| Eleven refused inbound cases, `apps/agent-daemon/test/daemon.test.ts:1231` | Expected one linked record and received zero in each case. | Each check yields one body-free refusal with the raw-byte digest. Neither model runs and the inbox and ingest record remain absent. |
| Local CLI and signed anchor, `apps/agent-daemon/test/gate-setup.test.ts:725` | `TypeError: gate.head is not a function`. | The real gate signs and the CLI verifies the anchor. An altered decision, a forged signature in a rehashed chain and a tail truncated past an earlier anchor all fail. |
| Seeded Activity read, `apps/suite/test/agent-audit.test.ts:371` | The seeded decision failed legacy schema validation. | Both golden rows load, their display labels match and their range verifies. |
| Outbound evidence and heartbeat, `apps/agent-daemon/test/daemon.test.ts:2663`, `:2680` and `:2705` | The signer callback was missing, an audit failure resolved as a policy refusal and the expected heartbeat anchor was absent. | The decision is visible before rendering. Audit failure stops rendering, execution and cursor commit. Heartbeat and shutdown seal the moved heads once, including an intervening write. |
| Witness and file boundaries, `packages/agent-audit/test/verify.test.ts:371`, `:396`, `:408` and `packages/agent-audit/test/ledger.test.ts:200` | All four supplemental regressions failed against the baseline. The older verifier accepted a truncated history despite a supplied witness, and the other cases hit the legacy schema rejection. | Checked retained prefixes, signed identity and sequence claims, the immediate predecessor and the rotation boundary. The shared witness fixture is in `packages/agent-audit/test/fixture.ts:149`. |

### Verification

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/agent-model run build`, `pnpm --filter @jeswr/agent-audit run build`, `pnpm --filter @jeswr/app-agent-daemon run build` | Passed on Node 24. |
| `NEXT_TELEMETRY_DISABLED=1 npm_config_offline=true pnpm --filter @jeswr/app-suite run build` | Passed. Next generated 168 static pages and the web check inspected 562 chunks. Webpack warned about dynamic imports in the existing guarded-fetch dependency. |
| `pnpm --filter <package> run typecheck` for agent-model, agent-audit, app-agent-daemon and app-suite | All four passed. The suite's missing workspace dependencies were linked from the offline cache with zero downloads, then built with their own scripts. |
| `pnpm exec vitest run --root packages/agent-model --maxWorkers=2 src test/exports.test.ts` | 188 passed. |
| `pnpm exec vitest run --root packages/agent-audit --maxWorkers=2 test/verify.test.ts test/mirror.test.ts test/ledger.test.ts test/audit.test.ts test/browser.test.ts test/stats.test.ts test/exports.test.ts` with the packaged child-process case filtered out | 148 passed and 1 filtered out. Achieved 100% coverage for statements, branches, functions and lines. |
| `pnpm exec vitest run --root apps/agent-daemon --maxWorkers=2` with daemon, gate, gate-setup, gate-channels, outbound, CLI, exports, instrumentation, polling-executor, composition, CSS and D-2 files selected | 188 passed and 3 filtered out after confirming the sandbox failures below. |
| `pnpm exec vitest run --root apps/suite --maxWorkers=2 --coverage.enabled=false test/agent-audit.test.ts` | 30 passed. |
| `node packages/agent-audit/bin/audit.mjs --help` and `node apps/agent-daemon/bin/awp.mjs --help` | Both passed directly. |
| `pnpm exec biome check <changed TypeScript files>`, `git diff --check`, and `VITEST_MAX_WORKERS=2 pnpm run lint:root` | Passed. Root Biome reported six existing environment-variable warnings in `scripts/vercel-production.mjs`. Codegen and the agent-layer, SDK-layer, RDF and duplication guards passed. |

### Deviations and follow-up

- CSS and the D-2 integration case hit `listen EPERM` on loopback. The packaged audit and daemon subprocess cases received empty stdout. A direct subprocess probe reported `spawnSync EPERM`, and the two binaries printed help when started directly.
- The audited signer is the daemon's projection seam. This keeps the binding and account preflight ahead of signing and lets the daemon require a durable decision before projection. The offline CLI audit is an explicit local mode alongside proposal audits.
- The existing gate provided its EdDSA key and represented party. The scenario rebuild and comparison instructions were conditional on an agent-reference source change.
- Bead to file under P7.4. Coordinate gate and suite ledger retention and document how to preserve independently held anchor heads and historical verification keys. Tail detection extends through the latest retained witness.

## Phase 4 review fixes, round 1 (41p)

### Changes

| Location | Change |
| --- | --- |
| `apps/agent-daemon/src/gate.ts:290`, `apps/agent-daemon/src/daemon.ts:170` | The gate commits the direction, outcome, reason and digest before returning a check or release. Startup and account processing replay committed decisions after the last linked gate head. The audit ID is derived from the gate sequence and hash. A repeated delivery with the same cursor, item and result reuses the gate decision. |
| `packages/agent-audit/src/ledger.ts:11`, `packages/agent-audit/src/file-ledger.ts:87` | Both ledgers reuse a retained gate decision with identical content and reject ID collisions. Retrying a mirror write reuses the original sequence and timestamp. |
| `packages/agent-audit/src/verify.ts:101`, `apps/agent-daemon/src/cli.ts:211` | Check every gate-held witness against the suite head and the adjacent anchor. A valid checkpoint can cover either pruned row. The CLI and README state the limit on detecting truncation of an unwitnessed tail. |
| `packages/agent-audit/src/records.ts:87`, `apps/agent-daemon/src/gate.ts:85` | The writer, schema and daemon use the exported list of body-free reason codes. |
| `apps/agent-daemon/src/gate.ts:267`, `apps/agent-daemon/src/gate.ts:536`, `packages/agent-reference/src/runtime/agent.ts:3421` | Startup checks the configured identities against a worst-case signed anchor. The runtime signs and checks each actual JWS against the shared 4 KiB bound before recording its witness. The daemon commits the local anchor first so an intervening audit append cannot leave a witness for a stale head. A mirror-only failure preserves the local pair and surfaces the error. |
| `apps/agent-daemon/src/daemon.ts:432`, `apps/agent-daemon/src/gate.ts:654` | Restored `sign: gate.release` on the leased factory. Both signer paths record the decision before rendering and still require the exact released bytes. The executor retains its independent dispatch checks. |

### Regression evidence

| Case | Baseline failure | Fixed behavior |
| --- | --- | --- |
| Gate commit followed by audit append failure, then reopen | Startup left zero linked decisions. | Reopening with no accounts reconstructs the decision before redelivery. An interrupted outbound append is also recovered with its task context, and execution stays blocked on the failed pass. |
| Mirror fails after the local append | Retry added a second local decision. | The daemon and public ledger reuse one decision. Changing the content under its ID fails. |
| Newest anchor missing or truncation before the latest witnessed head | Removing the newest anchor still produced `PASS`. | The verifier and CLI report the missing witness evidence. |
| Latest witness pruned in a normal rotation | A checkpointed prefix failed verification. | A valid checkpoint covers a pruned head and, when applicable, its anchor. A retained anchor still has to match the witnessed head. |
| Body-like lowercase slug as a reason | `private-prompt-text` passed schema validation. | The schema and public writer reject it. |
| Oversized signed receipt from Unicode WebIDs | The gate opened and wrote the witness. | Startup rejects the identities. A direct anchor attempt fails before publishing or writing a witness. |
| Previously documented factory signer | `gate.release is not a function`. | The legacy composition records both refusals and successful releases. A real channel renderer sees the successful decision already in the ledger. |

### Verification

| Check | Result |
| --- | --- |
| Local Node 24 builds and typechecks | Agent-audit, agent-model and the daemon built with their package scripts. Agent-audit, agent-model, the daemon, agent-reference, and the suite passed typecheck. |
| Agent-audit focused Vitest | 152 passed, one packaged subprocess case excluded. Statements, branches, functions and lines each reached 100%. |
| Agent-model focused Vitest | 188 passed. |
| Daemon focused Vitest | 192 passed, one packaged subprocess case excluded. The separate CSS and D-2 run passed its three offline checks and hit `listen EPERM` in the two loopback integrations. |
| Suite agent Vitest | 484 passed across 23 files, run from the suite directory. |
| Agent-reference library-only rebuild, focused tests and scenario comparison | Compiled with `tsc -p tsconfig.build.json` and copied generated assets. All 18 focused tests passed. `mortgage-core` and `pay-an-invoice` ran with zero disagreements. Only `generated.commit` and manifest ordering differed. Restored the generated files byte for byte. |
| Biome, root guards and `git diff --check` | Passed with existing Biome warnings in the reference runtime and root scripts. |

All Vitest selections used `--maxWorkers=2`. The packaged audit and daemon subprocess tests received empty stdout in this sandbox. Both CLIs printed help when invoked directly with Node. No commit was made.

Recovery uses completed suite decisions retained in the gate ledger. Older reference records may omit the digest of the original channel bytes, so recovery does not infer that digest from a signature or message payload. The retention and historical-key follow-up from 41o still applies.

<!-- AUTHORED-BY Codex GPT-6 -->

## Phase 4 review fixes, round 2 (41q)

| Finding | Regression evidence |
| --- | --- |
| Checkpoints could replace all witnessed evidence | The baseline passed a checkpoint that omitted the latest witnessed head and anchor, and rotation deleted both while a newer anchor awaited its witness. Verification now requires both rows. Retention protects the two newest anchors and their predecessors so the preceding witness remains available during publication of the next anchor. An older witness can be covered by an intact checkpointed prefix. |
| Gate ledger fsync before the state checkpoint | Reopening the baseline stopped at `Gate ledger changed while reading decisions`. Startup now uses the reference ledger API to recover to the saved state head, restores the pending decision, and projects it before executor dispatch. The regression also verifies the interrupted pass made no Reader or Proposer calls. |
| Committed check or release before the decision row | The baseline reopened with no decision for a confirmed inbound refusal or a successful outbound release. The gate journals body-free decision fields ahead of verdict or receipt publication and checks the completion marker on recovery. The recovered refusal and release each appear once and retain the expected outcome and digest. |
| Older gate snapshot next to newer suite decisions | The baseline started successfully after restoring a coherent older gate snapshot. Startup now rejects a suite decision or checkpoint whose gate sequence and hash are unavailable and stops before model calls or dispatch. |
| All linked decisions pruned | The baseline projected a duplicate after retention removed every linked decision. Pruning now carries the highest removed gate sequence and hash forward through subsequent checkpoints. Reconciliation uses the higher watermark from checkpoints and retained decisions. |
| Durable suite anchor without a gate witness | The baseline dispatched without repairing the anchor, and the offline CLI passed it. Startup now verifies the anchor signature and witnesses its exact head once across successive restarts. The offline auditor reports a missing matching witness as a breach. |

Gate ledger access uses the agent-reference APIs. Legacy checkpoints decode without gate coordinates. Recovering already pruned witnessed heads requires the original suite records. Recovery applies to suite checks and releases with durable completion markers, and interrupted operations retain the gate's existing hold behavior.

### Verification

- The daemon's offline selection passed 288 tests. A separate final run passed all seven targeted daemon regressions. The loopback CSS and D-2 cases and the packaged CLI and launchd subprocess cases were excluded from the offline selection. Both CLI binaries printed help when invoked directly with Node.
- Agent-audit passed 155 tests with 100% statement, branch, function and line coverage. The packaged subprocess case was excluded.
- Agent-model passed 188 tests. The Suite agent selection passed 484 tests across the main run and an isolated retry of the route tests. The focused Suite audit file passed all 30 tests.
- Agent-model, agent-audit, the daemon and the Suite passed builds and typechecks. The Suite production build generated 168 pages and checked 562 chunks, with the existing guarded-fetch dependency warnings.
- Root lint and the agent layer, RDF discipline and app duplication guards passed. Agent-reference source and trace files are byte-for-byte identical to the baseline.

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

## Phase 4 review fixes, round 3 (41s)

| Finding | Change and regression |
| --- | --- |
| 1. Retained suite links after gate pruning | `packages/agent-audit/src/verify.ts:103` accepts links at or below the verified gate retention boundary and counts them as unverifiable-pruned. Startup and `awp audit` take that boundary from the existing reference ledger check. In-range hash mismatches and links above the committed gate head still fail closed. The verifier test at `packages/agent-audit/test/verify.test.ts:390` and both startup cases at `apps/agent-daemon/test/daemon.test.ts:2951` failed with `gate record missing` on `662d72a8f`. The final cases exercise pruning with the real reference file ledger and confirm startup reaches dispatch and the CLI reports the pruned link with `PASS`. |
| 2. Signatures on witnessed anchors | `apps/agent-daemon/src/daemon.ts:207` validates every retained anchor with the same EdDSA verification used by `awp audit`, before recovering any missing witnesses. The forged-signature test at `apps/agent-daemon/test/daemon.test.ts:3044` resolved successfully on the baseline. It now rejects at startup before the Reader or dispatch runs. |
| 3. Offline witnesses beyond the saved head | `apps/agent-daemon/src/gate.ts:735` checks the same saved prefix for startup and offline audit. Startup uses the reference rollback API. Offline audit reads the prefix without rewriting either file or opening the runtime lock. The regression at `apps/agent-daemon/test/gate-setup.test.ts:872` returned `PASS` on the baseline after restoring the pre-witness state checkpoint while leaving the fsynced witness in the ledger. It now reports a missing witness and verifies that both gate files are byte-for-byte intact. Reopening the gate rolls back that witness. |

Finding 4 hit the ledger-only replay stop condition. The crash window before suite staging remains open. The missing evidence differs by outcome.

- **Inbound admit or refuse after `receive`.** The suite records the digest of the raw channel delivery. The reference runtime receives the JWS and binding and records a canonical message digest for `message-in`. Its `rejection` can identify the reason, but it carries no raw channel digest. The inbound gate verdict and the final protocol result can also differ. See `apps/agent-daemon/src/gate.ts:149`, `:540` and `packages/agent-reference/src/runtime/agent.ts:4777`, `:4982`, `:5008`.
- **Outbound go after `sendMessage`.** The ordinary compact release records the canonical message digest in `message-out`. The suite requires the digest of the exact compact JWS. The `wireDigest` field on the reference delivery-pointer path is a digest of the wire object. The usual compact release also precedes the adapter's renderability and mandate rechecks. See `apps/agent-daemon/src/gate.ts:164`, `apps/agent-daemon/src/outbound.ts:163` and `packages/agent-reference/src/runtime/agent.ts:9253`, `:9274`.
- **Outbound stop or ask-principal after `sendMessage`.** A recorded denial or hold can establish the reference verdict, but carries no suite proposal digest or task context. The compact-carrier path can also return a refusal or reuse an existing hold without a new outcome row. See `apps/agent-daemon/src/gate.ts:164` and `packages/agent-reference/src/runtime/agent.ts:6100`, `:6152`.

No replay change or passing regression is claimed for finding 4. The legacy-checkpoint finding was left alone as directed. Checkpoints written before Phase 4 cannot have pruned gate-decisions because that record kind was introduced in Phase 4.

### Verification

| Check | Result |
| --- | --- |
| Builds and typechecks on Node 24.22.3 | Agent-model, agent-audit and the daemon passed their package build scripts. Those three packages and the Suite passed typecheck. |
| Daemon `pnpm exec vitest run --root apps/agent-daemon --maxWorkers=2` with the 41q offline filters | 292 passed and 4 filtered. The filters exclude cloud and production fixture files, loopback CSS and D-2 integration cases, and the packaged CLI and launchd subprocess cases. |
| Reference library-only `pnpm exec tsc -p tsconfig.build.json && node scripts/copy-generated.mjs`, then focused daemon regressions | The build passed. All 7 selected daemon tests passed against the rebuilt reference library. |
| Agent-audit `pnpm exec vitest run --root packages/agent-audit --maxWorkers=2` with the 41o audit file selection | 156 passed and one packaged subprocess case filtered. Statement, branch, function and line coverage each reached 100%. |
| Agent-model `pnpm exec vitest run --root packages/agent-model --maxWorkers=2 src test/exports.test.ts` and Suite `pnpm exec vitest run --maxWorkers=2 --coverage.enabled=false test/agent-audit.test.ts` | Passed 188 and 30 tests, respectively. |
| Direct Node invocations of `awp --help` and `audit --help` | Both passed. |
| `pnpm exec biome check` on all changed TypeScript, `VITEST_MAX_WORKERS=2 pnpm run lint:root` and `git diff --check` | Passed. Root Biome emitted its six existing warnings in `scripts/vercel-production.mjs`. |

Agent-reference source and committed traces match `662d72a8f` byte for byte. The worktree is uncommitted.

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

## Phase 5, daemon (41v)

- `src/cloud-receivers.ts:54` supplies `createGateReceiver(gate)` for A2A. It passes
  the original body bytes and HTTP header values to the leased gate as
  `a2a-request` carriage. The response uses `a2aResponse` to carry a receipt or
  a reason code. A request with invalid JSON-RPC framing returns `malformed`.
- `src/cloud.ts:80` adds `POST /answerable` for gate-backed cloud compositions
  under the existing dev opt-in. It accepts the two reference media types and
  shares the 64 KiB body and 64 in-flight request bounds with A2A. Under TR-8,
  admission and refusal both return HTTP 200 after transport receipt.
- `src/gate.ts:510` routes both transports through the gate's serialized check
  and durable decision path. Verdict keys cover the carriage metadata used by
  the reference runtime. HTTP replays return `replay-conflict`. The receivers
  hold only the inbound capability and leave runtime replies in its internal
  outbox.
- `README.md:420` documents trusted composition, accepted requests and refusal
  responses. The existing custom A2A composition still works.

### Verification

| Check | Result |
| --- | --- |
| Daemon dependency builds and `pnpm --filter @jeswr/app-agent-daemon run build` | Passed on Node 24.22.3. Agent-reference used `npx --no-install tsc -p tsconfig.build.json && node scripts/copy-generated.mjs`. |
| `pnpm --filter @jeswr/app-agent-daemon run typecheck` | Passed for the source and tests. |
| Focused daemon Vitest with `--maxWorkers=2` | 289 passed across 16 offline files. Two existing packaged CLI and launchd subprocess checks were filtered after failures in this sandbox. A direct Node invocation of `awp --help` passed. The production packaging and CSS loopback fixtures were outside this selection. |
| `pnpm exec vitest run --root apps/agent-daemon --maxWorkers=2 test/cloud.test.ts` | The dev configuration test passed. At the loopback setup, 18 tests hit `listen EPERM`. A temporary in-process HTTP harness passed all 19 tests and reproduced five ingress failures against the baseline listener. The built receivers also passed replay checks against the real synthetic gate without sockets. |
| `pnpm exec biome check apps/agent-daemon`, `node scripts/check-agent-layers.mjs`, `pnpm run check:rdf-discipline`, `git diff --check` | Passed. The RDF guard found zero daemon violations. |

The loopback cases cover compact A2A and direct HTTP, signed document direct
HTTP, exact bounded bytes and A2A headers, tampered proofs with reason-only
responses, replays, and the shared in-flight limit. The valid discovery
messages cause the reference runtime to prepare replies locally. The tests
check for zero transmissions and zero outbound gate calls. All tracked edits
are in the daemon. Temporary test fixtures were removed.

<!-- AUTHORED-BY Codex GPT-6 -->

## Review 41r19 fixes

- Both HTTP routes reserve one of the 64 shared slots before reading the body.
  A test fills the slots with unfinished uploads, gets a 503 before sending any
  extra body bytes, and checks that disconnecting a sender frees a slot.
- Early 415, 413 and 503 responses close the connection after the response is
  sent. Chunked uploads on both routes test that a 415 consumes no body bytes
  and a 413 consumes at most 64 KiB.
- Admission and refusal both return HTTP 200 for a 64 KiB A2A request. The
  built-in reply size is bounded by the receipt and the request's correlation ID.
  The A2A test also checks that the gate receives the original JSON spacing,
  key order and escapes.
- Facts become visible only after the decision record commits. A forced commit
  failure keeps the delivery's fact hidden during and after the write attempt.

TypeScript and Biome passed. The regular Vitest run passed 294 tests. Loopback
binds failed with `EPERM` in 25 cloud tests, the CSS composition test and the D-2
integration test. The packaged CLI, production packaging and launchd subprocess
tests also failed. A separate run over local socket pairs passed all 26 cloud
tests using Node's HTTP parser. The full workspace gate stopped at the unrelated
suite-native build because `@capacitor/core` was unavailable.

<!-- AUTHORED-BY Codex GPT-6 -->

## Review round 2 fixes

- Both entrances assemble exact body bytes from the request's `data` and `end`
  events. The listener reserves a slot before attaching the reader and checks
  each parser chunk against the remaining budget before buffering or emitting it.
  Four fixed-length and chunked cases send each request in one write, check its
  reply and then fill all 64 slots again. All four reproduced the missing reply
  on `0265962e6` over socket pairs with Node's buffered HTTP parser path.
- Unsupported `Expect` values, including mixed values containing
  `100-continue`, receive 417 and `Connection: close` on both routes. Tests
  verify zero body bytes read and full slot capacity after the refusals.
- The built-in A2A receiver accepts 65,024 bytes and reserves 512 bytes of the
  reference client's 64 KiB limit for the reply envelope and receipt. The
  serialized correlation ID can take up to half the request budget because
  the reply carries it twice. The boundary tests read admission and refusal
  with `readA2a`. The direct HTTP cases use the reference bounded JSON reader
  for both outcomes at 64 KiB.
- Under TR-8 a committed admission or refusal receives HTTP 200. Tests force a
  real decision-record commit failure for each outcome on each route and
  verify identical empty HTTP 503 replies with matching headers apart from the
  generated Date. The existing fact visibility regression still passes.

### Verification

- Source and test TypeScript checks, Biome and the agent layer guard passed
  on Node 24.22.3.
- The regular Vitest run passed 294 tests. Loopback setup returned `EPERM`
  in 35 cloud tests, the CSS composition test and the D-2 integration test.
  The packaged CLI, launchd and production packaging subprocess tests also
  failed in the sandbox. The socket-pair rerun passed 329 tests, including all
  36 cloud tests using Node's HTTP parser, with those five fixtures excluded.
- The full workspace gate stopped on unrelated builds missing
  `oauth4webapi` and `@capacitor/core`.
