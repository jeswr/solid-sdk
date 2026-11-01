<!-- AUTHORED-BY Codex -->

Round 61 fixes three classes across Drive. Paths below are relative to `apps/suite/`.

| Finding / class | Shared fix and every changed source path | Regression tests |
| --- | --- | --- |
| Missing Link on 404 loses Replace recovery; ordinary creation rejects its first endpoint. Class: conflating undiscovered endpoints with captured endpoint replacement. | `lib/client/access.ts`: access bindings accept first discovery only from a new, strong conditional-creation receipt. Captured endpoints and own-ACL absence stay pinned. `lib/client/client.ts`: the payload creation seam records receipts before verification; `lib/client/ancestors.ts`: the provisioning seam records its receipt; `lib/model/root.ts`: root creation records its receipt. | `drive-review-round61.test.ts`: `Replace evacuates both versions privately when 404 omits Link`; creation table for New folder, Upload, Move, Copy, Rename, Trash, Restore, folder Move, container merge, owner-only folder/file; seven invalid/stale/foreign receipt variants. `drive/root.test.ts`: `root creation binds the successful PUT endpoint when 404 omits Link`. |
| Retained protection widens during ledger retirement. Class: treating verification before local persistence as the final protection proof. | `lib/client/ancestors.ts`: shared `retireProtection` verifies captured own policy, resource identity, and ACL endpoint after ledger clearing; failure restores the durable requirement. Both installation and existing-protection verification use it. ACL PUT receipts are persisted before verification GETs, so a lost verification read can resume its own captured policy. Unrecorded endpoints cannot authorize repair. `lib/client/protection-ledger.ts`: a failed retirement retains the actual installed own-ACL receipt, so Retry cannot adopt a different endpoint or revive a revoked policy. `lib/client/client.ts`: `secureRetained` privately evacuates on failure; quarantine verifies backup policy and content after its final ledger work. Successful evacuation still surfaces the observed ACL change; ambiguous deletes retain their pending status. Explicit demo recovery checks content without attempting unsupported ACL installation. | `drive-review-round61.test.ts`: `retained protection is rechecked after ledger retirement and widened bytes evacuate privately`; `protection verification keeps its durable requirement after retirement %s` (widening, endpoint replacement, missing validator); Retry variants for removed/unchanged ACLs and a narrower installed policy; backup-retirement policy change. |
| Destination replacement during source retirement. Class: access-only completion checks ignore captured survivor content. | `lib/client/client.ts`: Move/Rename/Restore verify every captured destination inside the partial-recovery handler after retirement; Copy checks its PUT identities before success. The overwrite backup GET must match the approved validator before an overwrite is allowed. Duplicate removal captures recovery bytes before deletion, checks survivors after retirement, and privately retains captured bytes on failure. A confirmed DELETE never authorizes clearing a recreated resource. | `drive-review-round61.test.ts`: Move/Rename/Restore destination-replacement table; partial file/folder Restore retirement table; `Copy detects a replaced payload before reporting completion`; six `refuses an unconfirmed backup GET` variants. Move/Rename/Restore also cover servers returning 200 with a different ETag despite HEAD If-Match. `drive-interactions-ui.test.ts`: `Move reports a destination replacement before offering Undo`. |
| Partial Restore audience comparison. | Existing archived-original policy comparison remains authoritative; the owner-only Trash copy does not replace that original policy. | `drive-review-round61.test.ts`: `partial Restore keeps the archived shared audience after Trash DELETE refusal`. This already passes against the original source. |

All `lib/…` source paths in the table are under `src/apps/drive/`.

The two destructive-step classes remain enforced by the shared `commitHttp` /
`commitIrreversible` boundary: captured validators supply the request preconditions,
all hydration/persistence/callbacks precede its final raw HTTP checks, and commit
disarms compensation before retirement. No later GET/HEAD supplies a replacement
validator for a refused operation. Container identities advance only from atomic
receipts of Drive's own mutations.

`drive-review-round54-boundaries.test.ts` runs the current round's two-shape matrix:
40 steps × validator replacement / IndexedDB-and-Web-Lock ordering. Its steps are
Trash index overwrite; Move; Rename; Trash; remove; recursive remove; Delete forever;
Empty Trash; overwrite; folder metadata; Restore; partial file/folder Restore;
Copy payload; ACL overwrite; replacement/Copy/container rollback; metadata undo;
policy archive/receipt/slot/ancestor cleanup; owner-only ACL/file/folder overwrite;
private-folder ACL; protection repair; retained/replay recovery clearing; container
merge; partial-folder Restore metadata; file/container rollback without Link;
folder-overwrite/partial-Restore rollback with child defaults; inherited replacement
rollback; container-provisioning ACL; metadata-undo recovery clearing; post-retirement private-backup ACL creation.
Both new post-retirement matrix cases fail against the original source. The round 57 matrix additionally checks the original selection validator surviving
preflight for twelve operation types.

Every audited call site (unchanged correct sites are included):

| Path under `src/apps/drive/` | Call sites |
| --- | --- |
| `lib/client/commit.ts` | `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; `Compensation.arm`, `disarm`, `rollback`. Final identities and mutation inputs are hydrated data; the boundary owns the last HTTP requests. |
| `lib/client/access.ts` | `discover`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; `store`, `install`, `privateFolder`; `bindAccess.resolve`, creation acceptance, `identities`, `destinationOwn`, `destinationPolicy`, `installed`, `recheck`, `retire`, `rollback`; `intersectAccess`, `projectAccess`, `materializeAccess`, `retargetAccess`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. |
| `lib/client/client.ts` | `captureResource`, `checkContainerVersion`, `requireOwnReceipt`, `captureOwnAccess`, `createdOwnAccess`, `stat`, `readVersion`, `readRdf`, `snapshot`, `verifySnapshotIdentity`; transfer destination capture and `verifyDestination`. |
| `lib/client/client.ts` | `guardedWrite` and both compensation branches, `write`, `rawPut`, `replayProtected`, `replayOrQuarantine`, `quarantine`, `createFolder`, `prepareTrash`. |
| `lib/client/client.ts` | `deleteVersion`, `deleteSnapshot`, `remove`; `copySnapshot`, `transfer`, `copy`, `move`, `rollback`, `secureRetained`; post-retirement survivor verification and private preservation. |
| `lib/client/client.ts` | `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, `mergeContainer`, metadata compensation, `verifyMerge`, `bindDestination`, public `bindAccess`, `exclusive`, public write/copy/move/remove wrappers; access scope checks, retirement, and compensation selection. |
| `lib/client/container-versions.ts` | `track`, `prepare`, `current`, `identity`, `committed`. Later reads do not advance approved identities. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`; `classifyDelete`. Intent persistence precedes final checks; committed deletion disarms compensation before ledger clearing. |
| `lib/client/protection-ledger.ts` | `protectionLedger`, `deletionLedger`, durable `get`, `set`, `clear`, migration and request retirement. Failed protection retirement retains the resource and installed own-ACL receipts. |
| `lib/client/cleanup.ts` | `discardVersion`, `ownsEmptyContainer`. Refusal probes remain read-only and never authorize a refreshed deletion. |
| `lib/client/source-operations.ts` | `sourceOperation`, lock acquisition and release. Locks are acquired before entering HTTP mutation boundaries. |
| `lib/operations/operations.ts` | `uploadFile`, `renameItem`, `moveItems`, `copyItem`, `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `markRecovery`, `reconcilePending`, `listTrash`, `trashItems`, `trashItemsUnlocked`, `runTrash`, `requireTrashEntry`, `removeCompletedRecords`. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`, `restoreMissing`, `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Restore comparisons use the archived original policy and pass captured survivor identities into conditional recovery deletion. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, initialization/resume and conditional marker/index writes. Root creation now supplies the same access-binding receipt. |
| `state/ui.tsx` | `openDialog`, `refreshAfter`, rename/move/copy/Trash/Restore/Delete forever/Empty Trash/source-delete actions, Undo callback, `reportFailure`, `errorMessage`, `recoveryLocations`. |
| `state/undo.ts`, `state/uploads.ts` | `moveWithValidator`, tree checks and conditional fetch wrapper; upload conflict capture, `pump`, `resolve`, retry, `describe`. Undo uses the move receipt; Replace retains the conflict decision's validator. |
| `state/resource.ts`, components | `useLiveResource`, `withHydratedMetadata`; `file-browser.tsx` selection, commands, preview reconciliation; `dialogs.tsx` rename/move/source-delete/Trash-delete snapshots; `views.tsx` Delete forever/Empty Trash snapshots; `preview.tsx` loaded-file validator; `upload-dock.tsx` progress and error announcements. |

Concurrent changes between separate Solid requests remain possible. Drive stops on
unexpected identity/access changes, preserves available recovery, surfaces the
failure, and never adopts another client's ACL/content validator to revert it.

Additional changed tests: `drive-client.test.ts` and `drive-safety.test.ts` now
expect a reported partial failure when a Copy destination lacks its PUT receipt;
they still verify original bytes and retained copies. The safety rollback test
allows additional reported recovery while verifying an unrelated child survives.
`drive-mergegate-round13.test.ts` preserves successful Retry after an acknowledged
ACL PUT whose verification read failed, and checks the changed-policy message for
foreign policy/demo replacements. `drive-mergegate-round15.test.ts` keeps a missing
creation endpoint blocked even when later HEADs expose Link; it cannot invent a
captured endpoint. Repair fixtures in rounds 54 and 60 now supply captured own-ACL
absence explicitly.

Complete changed paths:

```text
src/apps/drive/lib/client/README.md
src/apps/drive/lib/client/access.ts
src/apps/drive/lib/client/ancestors.ts
src/apps/drive/lib/client/client.ts
src/apps/drive/lib/client/protection-ledger.ts
src/apps/drive/lib/model/root.ts
test/drive-client.test.ts
test/drive-interactions-ui.test.ts
test/drive-mergegate-round13.test.ts
test/drive-mergegate-round15.test.ts
test/drive-review-round54-boundaries.test.ts
test/drive-review-round60.test.ts
test/drive-safety.test.ts
test/drive/root.test.ts
test/drive-review-round61-audit.md
test/drive-review-round61.test.ts
```

Reproduction and final validation:

- The final functional regressions and both new matrix cases were run against the
  original source in an isolated `/tmp/drive61-before` tree: **46 failed, one passed**.
  The passing case is the already-correct archived shared-original comparison.
  Eight tests for the new receipt API were excluded from that comparison; the
  other 170 skipped tests are existing root/matrix cases. No working-tree source
  was replaced for these baseline runs. The strengthened ACL-warning assertion
  also failed before the error-propagation change.
- The final `drive-review-round61.test.ts` has **52 tests**. The boundary matrix has
  **80 tests** over 40 steps, including both new post-retirement private-backup ACL
  cases. The existing round 57 matrix additionally covers selection-time validators.
- From `apps/suite`, with `PATH=/opt/node24/bin:$PATH`, the final
  `npx vitest run --coverage` (with JSON/report-on-failure reporters) passed:
  **268 files, 12,594 tests**, exit 0. All **481 configured source files** individually
  have **100% statements, branches, functions, and lines**. Coverage includes and
  thresholds are unchanged.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed. All 16 changed paths are under `apps/suite/`.

No dependencies, shared packages, fonts, commits, or network access were needed.
Playwright was skipped as requested because localhost ports cannot be bound.
Changes remain in the working tree on `claude/DRV-04`.

