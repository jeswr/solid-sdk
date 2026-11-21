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
