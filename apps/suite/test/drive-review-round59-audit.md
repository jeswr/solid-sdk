<!-- AUTHORED-BY Codex -->

# Drive review round 59

## Findings and shared invariants

| Finding / class | Fix and every affected path | Regression |
| --- | --- | --- |
| Failed partial Restore erases child defaults: an access-comparison projection was reused as a replacement ACL. | `lib/client/access.ts`: `bindAccess.destinationPolicy` retains the complete captured own ACL; comparison projections remain separate. `lib/client/client.ts`: standalone overwrite compensation in `guardedWrite`, its quarantine policy, and existing-container metadata compensation in `mergeContainer` all use that complete policy. `replayProtected` preserves an unchanged captured ACL on both initial replay and replay-repair paths, including unrelated clauses and separate defaults. Its ACL receipt joins `guardedWrite`'s final HTTP guards. | `drive-review-round59.test.ts`: `failed $step preserves the complete captured ACL after $failures post-PUT failures`, over partial Restore / folder overwrite and one / two verification failures. The original cases reproduced signed-out child reads changing from 200 to 403. The two-failure variants additionally reproduced unrelated clauses disappearing during replay repair. All four now preserve the exact ACL bytes and child access. |
| Failed quarantine hides recovery: a committed backup's location was lost when subsequent asynchronous work failed. | `lib/client/client.ts`: one `quarantine` error boundary covers folder creation, access discovery, all backup writes, receipt validation, ledger hydration, conditional clearing and ledger persistence. It accumulates successful and nested recovery URLs without duplicates. A synchronous `onWritten` receipt records a backup even when `write` subsequently rejects. A read-only lookup of that uncertain backup can exclude a confirmed removal; it never supplies a mutation validator. All callers benefit: standalone overwrite/create compensation, replay repair, and `secureRetained` used by Copy/Move rollback and retained transfers. | `drive-review-round59.test.ts`: `quarantine reports earlier backups when later discovery/backup PUT fails`; `quarantine reports a committed backup with no PUT receipt` (also failing verification, unavailable discovery, and confirmed 404/410); `quarantine reports all saved backups when protection-ledger hydration fails`; `quarantine accumulates earlier and nested backup locations`. `drive-review-round59-ui.test.ts`: `upload Replace displays the original's only recovery location when the second quarantine backup fails`, asserting the real queue's error text, retained original bytes, and private access. |
| Shape (a), captured ACL identity replaced by later discovery. | `lib/client/access.ts`: the shared `store` boundary rejects a discovered endpoint that differs from `knownAcl` or `expectedAcl.url`; `install` preserves the caller's captured endpoint. The captured ACL ETag/absence and resource ETag remain conditional through installation, owner-only protection, ancestor repair and compensation. | `drive-review-round59.test.ts`: `ACL installation keeps its captured endpoint with own ACL / own ACL without fallback / ACL absence`. `replay preserves a concurrent ACL endpoint/validator change and reports private recovery` checks that neither ACL is overwritten and recovery is private. |
| Shared partial Restore compares against a private recovery copy. | The existing `recoveryPolicy` and public `bindAccess` implementation already compare against the original policy archived at Trash time, keeping recovery's live owner-only ACL as the access-recheck baseline. This invariant is retained. | `drive-review-round59.test.ts`: `partial Restore compares an unchanged shared original with its archived policy after Trash DELETE 403`, with independent public child defaults and blank-node folder metadata. The round 58 matrix also covers shared files/folders with own/inherited grants after refused DELETE. |
| Shape (b), local asynchronous work after the last identity check. | The existing `commitHttp` boundary takes hydrated request and guard data. Ledger reads, locks, serialization, content proofs and access discovery finish before its final raw HTTP checks and the conditional request. `guardedWrite` now also carries a replay's pre-hydrated ACL receipt through this boundary. No asynchronous hydration callback was added after the final check. | The table in `drive-review-round54-boundaries.test.ts` now covers 36 scenarios with both shapes (72 tests), adding folder overwrite rollback and partial Restore rollback with independent child defaults. IndexedDB and Web Lock instrumentation checks every destructive request in each operation. The round 57 matrix additionally checks captured selections through preflight. |

Compensation remains conditional on Drive's own content and ACL receipts. A foreign content or ACL replacement is never a new rollback baseline. Successful destructive steps disarm their compensation before bookkeeping. No extra mutation recheck was added for the accepted interval between Solid requests; the extra quarantine lookup is error reporting only. Conditional mutations and operation rechecks still surface that interval and retain recovery.

## Every audited call site

Paths below are relative to `apps/suite/src/apps/drive/`. The audit traced callers as well as every raw destructive request (payload PUT, quarantine clearing PUT, ACL PUT and DELETE).

| Path | Audited call sites |
| --- | --- |
| `lib/client/commit.ts` | `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; `Compensation.arm`, `disarm`, `rollback`. |
| `lib/client/access.ts` | `store`, `install`, `privateFolder`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`, `intersectAccess`, `projectAccess`, `materializeAccess`, `retargetAccess`; `bindAccess.resolve`, `identities`, `destinationOwn`, `destinationPolicy`, `installed`, `recheck`, `retire`, `rollback`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. |
| `lib/client/client.ts` | `captureResource`, `checkContainerVersion`, `requireOwnReceipt`, `createdOwnAccess`, `stat`, `readVersion`, `readRdf`, `snapshot`, `verifySnapshotIdentity`, `verifyDestination` and destination `capture`. |
| `lib/client/client.ts` | `guardedWrite` and both compensation branches; `write`, `rawPut`, `replayProtected` and replay repair, `quarantine`, `createFolder`, `prepareTrash`. |
| `lib/client/client.ts` | `deleteVersion`, `deleteSnapshot`, `remove`; `copySnapshot`, `transfer`, `copy`, `move`, `rollback`, `secureRetained`. |
| `lib/client/client.ts` | `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, `mergeContainer` and metadata compensation, `verifyMerge`, `bindDestination`, public `bindAccess`, `exclusive`, public write/copy/move/remove wrappers; scope rechecks, retirement and compensation selection. |
| `lib/client/container-versions.ts` | `track`, `prepare`, `current`, `identity`, `committed`. Only atomic receipts of Drive's own mutation advance captured parent validators. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`; `classifyDelete`. Deletion ledger persistence precedes final HTTP checks, and committed DELETE disarms undo before persistence can fail. |
| `lib/client/cleanup.ts` | `discardVersion`, `ownsEmptyContainer`. Refused conditional cleanup never adopts a fresh read's validator. |
| `lib/operations/operations.ts` | `uploadFile`, `renameItem`, `moveItems`, `copyItem`, `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `markRecovery`, `reconcilePending`, `listTrash`, `trashItems`, `runTrash`, `trashItemsUnlocked`, `requireTrashEntry`, `removeCompletedRecords`. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`, `restoreMissing`, `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. |
| `state/ui.tsx` | `openDialog`, `refreshAfter`, rename/move/copy/Trash/Restore/Delete forever/Empty Trash/source-delete actions, Undo callback, `reportFailure`, `errorMessage`, `recoveryLocations`. |
| `state/undo.ts`, `state/uploads.ts` | `moveWithValidator`, tree `verify`, conditional fetch wrapper; upload conflict capture, `pump`, `resolve`, retry and `describe`. |
| `state/resource.ts`, components | `useLiveResource`, `withHydratedMetadata`; `file-browser.tsx` selection, command and preview reconciliation; `dialogs.tsx` rename/move/source-delete/Trash-delete snapshots; `views.tsx` Delete forever/Empty Trash entry snapshots; `preview.tsx` loaded-file validator. |

The 36-step matrix explicitly covers Trash index overwrite; Move, Rename, Trash, remove and recursive remove; Delete forever and Empty Trash; overwrite and folder metadata; Restore and partial file/folder Restore; Copy payload; ACL overwrite; replacement, file Copy and container rollback; metadata undo; archive, marker, slot and ancestor cleanup; owner-only ACL, file and folder overwrite; private-folder ACL; protection receipt repair; retained and replay recovery clearing; container merge; metadata-bearing partial folder Restore; file/container rollback without Link; and both new rollback paths with child defaults.

## Changed files

- `src/apps/drive/lib/client/access.ts`: complete compensation policy and captured ACL endpoint invariant.
- `src/apps/drive/lib/client/client.ts`: both shared failure classes and replay ACL guards.
- `src/apps/drive/lib/client/README.md`: documents complete ACL preservation and recovery reporting.
- `test/drive-review-round59.test.ts`: findings, recovery failure variants, ACL replacement and shared-original regressions.
- `test/drive-review-round59-ui.test.ts`: actual upload queue recovery-location regression.
- `test/drive-review-round54-boundaries.test.ts`: whole-client two-shape matrix, expanded to the affected compensation paths.
- `test/drive-review-round56-edges.test.ts`: asserts preserved original causes through quarantine wrappers; covers unavailable recovery identifiers/controllers without hiding retained transfers.
- `test/drive-review-round59-audit.md`: this mapping and audit.

## Reproduction and validation

The initial round 59 client/UI regressions were run against HEAD's original `client.ts` and `access.ts` in an isolated `/tmp/drive59-before` copy: 10 failed and one passed. These failures reproduce both reported findings and the same classes in standalone overwrite, missing receipts, nested quarantine, later discovery, and captured endpoint substitution. The shared-original test already passed. The added ledger-hydration regression also fails against that original code.

After the initial fixes, the two replay-repair variants were run before the further fix: both failed because ACL clauses were dropped. The committed-backup/missing-receipt plus verification-failure case also failed before recording the synchronous PUT receipt. These checks kept the working tree intact; no source files were replaced to run the baseline tests.

The complete final round 59 client/UI regression files were then run against the original client again: **19 failed, one passed**. The already-correct shared-original Restore case is the single passing baseline test.

Validation commands ran from `apps/suite` with `PATH=/opt/node24/bin:$PATH`, without network access:

- `npx vitest run --coverage` (with additional JSON/report-on-failure reporters): **265 files, 12,505 tests passed**, exit 0. The JSON summary confirms all **481 configured source files individually have 100% statements, branches, functions and lines**; no thresholds or coverage globs were changed.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0, with 72 existing warnings and no errors.
- `git diff --check`: passed.

Playwright is skipped because localhost ports cannot be bound. No dependencies, shared packages or fonts were changed, and no commits were created.
