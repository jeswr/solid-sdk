<!-- AUTHORED-BY Codex -->

# Drive review round 58

## Findings and classes

| Finding | Class and shared fix | Reproduction / regression |
| --- | --- | --- |
| Both high ACL relocation findings | Non-injective RDF subject rebasing merged authorization clauses. `access.ts:materializeAccess` assigns a fresh blank subject to every applicable authorization before `retargetAccess` relocates targets. Principals, origins, modes, and the distinction between resource and default grants retain their identities. This covers `install`, ancestor requirements/protection, Copy, Rename/Move, archived Trash/Restore policies, and container merge. | `drive-review-round58.test.ts`: `Copy/Rename/Restore never merges colliding authorization identifiers`. Before the fix all three destinations returned 200 to signed-out reads; after the fix they return 403 and public grants contain only Append. |
| Merge adopts replacement validator | Shape (a): a later read superseded a captured identity. `commit.ts:assertVersion` is shared by HTTP identity checks, container receipt checks, and Restore comparisons. `mergeContainer` checks its placeholder and metadata PUT receipts and returns its captured destination identity; `restoreMissing` carries that identity to recovery DELETE. `sameRecoveryFile` checks its GET against its initial HEAD, refusing missing/weak initial validators. `copySnapshot` verifies its metadata PUT receipt too. Only atomic receipts for Drive's own mutations may advance a container validator. | `direct merge/partial Restore retains the placeholder PUT validator through listing` and `partial Restore pins its compared file/empty folder/metadata folder survivor before recovery DELETE` all failed before their fixes; replacement ETags and recovery survive afterward. Further tests cover Copy/merge metadata receipt verification and missing/weak survivor validators. |
| Hidden `Link` allows rollback to remove foreign ACL | Missing control ownership was treated as permission to clean up. `client.ts:requireOwnReceipt` is shared by file/container transfer rollback, retained-resource protection, and standalone upload rollback. A non-demo resource needs a captured own ACL or captured absence at a known endpoint. Missing ownership fails closed; protection never reads a foreign ACL as a new baseline. Recovery remains private and its locations are reported. | `Copy/Move rollback preserves a concurrent ACL when placeholder Link is hidden`; `standalone upload rollback cannot delete an ACL when absent-resource discovery was hidden`. All failed before the fixes. |
| Mixed bulk moves hide recovery | Bulk reporting discarded member errors, and wrapper errors could hide recovery locations. `state/ui.tsx` reports every failed member of Move, Restore, Trash, and Delete forever/Empty Trash; Undo and index persistence warnings retain their recovery details too. `recoveryLocations` recursively collects private backup URLs through partial-transfer, partial-Restore, and generic error causes, including access/pending/index wrappers. | `drive-review-round58-ui.test.ts`: `mixed bulk moves show every failed member's private recovery URLs` reproduced the surviving `0-a` bytes and failed before the fix. Table tests cover later failed members and nested pending recovery for all four bulk actions; `reverse move failures retain private recovery locations` covers Undo; `Restore/Trash/Delete forever persistence warnings preserve nested recovery locations` covers warnings. |
| Shared partial Restore | Preserve the existing `recoveryPolicy`/`bindAccess` invariant: comparison uses the policy archived at Trash time, while recovery's owner-only ACL remains its live access baseline. | `partial Restore keeps unchanged shared file/folder with own/inherited grants after Trash DELETE 403`: all four combinations retain the unchanged shared original and finish removing recovery. |

## Irreversible-step audit

All paths below are relative to `apps/suite/src/apps/drive/`. The audit traced captured identities, pre-hydration, final HTTP checks, conditional mutations, compensation ownership, and commit/disarm order. Existing correct paths remain unchanged.

| Path | Every audited call site |
| --- | --- |
| `lib/client/commit.ts` | `commitHttp`, `commitIrreversible`, `checkIdentity`, `assertVersion`; `Compensation.arm`, `disarm`, `rollback`. Request and identity inputs are hydrated before the helper's raw HTTP checks; no asynchronous callback occurs between those checks and the request. |
| `lib/client/access.ts` | `store`, `install`, `privateFolder`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`, `intersectAccess`, `projectAccess`, `materializeAccess`, `retargetAccess`; `bindAccess.resolve`, `identities`, `recheck`, `installed`, `retire`, `rollback`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. Cleanup with missing discovery already refuses deletion; installations retain expected ACL/resource identities through locks and ledger work. |
| `lib/client/client.ts` | `captureResource`, `checkContainerVersion`, `requireOwnReceipt`, `createdOwnAccess`, `stat`, `readVersion`, `readRdf`, `snapshot`, `verifySnapshotIdentity`, `verifyDestination`, destination `capture`. |
| `lib/client/client.ts` | `guardedWrite` and its replay/delete compensation, `write`, `rawPut`, `replayProtected`, `quarantine`, `createFolder`, `prepareTrash`. All payload overwrites and quarantine clearing retain captured ETags; ACL replays retain expected ACL receipts. |
| `lib/client/client.ts` | `deleteVersion`, `deleteSnapshot`, `remove`, `copySnapshot`, `transfer`, `copy`, `move`, `rollback`, `secureRetained`. File and container rollback share the own-ACL receipt invariant; source deletions disarm compensation when they commit. |
| `lib/client/client.ts` | `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, `mergeContainer` and metadata compensation, `verifyMerge`, `bindDestination`, public `bindAccess`, `exclusive`, public write/copy/move/remove wrappers. |
| `lib/client/container-versions.ts` | `track`, `prepare`, `current`, `identity`, `committed`. Fresh reads do not rebase an approved identity; only atomically captured mutation response receipts do. |
| `lib/client/deletion.ts`, `cleanup.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`; `classifyDelete`, `discardVersion`, `ownsEmptyContainer`. Ledger persistence precedes final HTTP checks; refused/ambiguous requests cannot authorize refreshing DELETE validators. |
| `lib/operations/operations.ts` | `uploadFile`, `renameItem`, `moveItems`, `copyItem`, `updateIndexUnlocked`, `updateIndex`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `markRecovery`, `reconcilePending`, `listTrash`, `trashItems`, `trashItemsUnlocked`, `runTrash`, `requireTrashEntry`. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`, `restoreMissing`, `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`, `removeCompletedRecords`. Survivor comparisons and archive cleanup keep their captured validators; retries do not rebase them. |
| UI and wrappers | `state/ui.tsx`: `refreshAfter`, rename/move/copy/Trash/Restore/Delete forever/source-delete actions, Undo callback, `reportFailure`, `errorMessage`, `recoveryLocations`; `state/undo.ts`: `moveWithValidator` and tree `verify`; `state/uploads.ts`: conflict confirmation, `pump`, retry, `describe`; `state/resource.ts`: `useLiveResource`, `withHydratedMetadata`; `components/file-browser.tsx`: captured selection and row reconciliation; `components/dialogs.tsx`: rename/move/source-delete/Trash-delete confirmation snapshots; `components/views.tsx`: Delete forever/Empty Trash snapshots. |

The two-shape table in `drive-review-round54-boundaries.test.ts` now covers 34 irreversible-step scenarios (68 tests), adding container merge, metadata-bearing partial folder Restore, and missing-Link file/container rollback. Shape (a) replaces the resource at its final HTTP check and verifies that Drive preserves the replacement. Shape (b) instruments IndexedDB and Web Locks and verifies that every destructive request immediately follows its HTTP identity check. The round 57 matrix additionally covers replacement before operation preflight for the selected validator passed through each operation. No new recheck was added for the accepted interval between Solid requests: conditional writes/deletes and post-operation checks remain the boundary.

The complete new regression files were also run against the original Drive implementation in an isolated `/tmp/drive58-before` copy: 19 tests failed and 6 passed. The failures reproduce all reported findings plus standalone-upload cleanup, survivor replacement during partial Restore, metadata receipt replacement, later bulk-member failures, nested pending recovery, and Undo recovery reporting. The already-correct shared-original and missing-validator cases passed on the baseline. The initial reported-finding reproductions were run and observed failing before their fixes in the working tree as well.

After adding the persistence-warning cases, the complete UI regression file was checked against that original implementation again: all 9 tests failed. On the fixed implementation those tests and the existing interaction/pending-deletion suites pass (155 tests across 4 files).

## Changed paths

- `src/apps/drive/lib/client/access.ts`: injective authorization materialization.
- `src/apps/drive/lib/client/client.ts`: shared ACL ownership guard for compensation/protection; merge/Copy use the container receipt invariant; merge exposes its destination identity through Restore.
- `src/apps/drive/lib/client/commit.ts`: shared synchronous captured-version assertion, also used by the raw HTTP identity check.
- `src/apps/drive/lib/operations/operations.ts`: file comparisons pin their initial HEAD; folder recovery DELETE keeps the merge destination receipt.
- `src/apps/drive/state/ui.tsx`: complete member-error reporting and nested recovery details.
- `test/drive-review-round58.test.ts`: finding reproductions and shared-original Restore matrix.
- `test/drive-review-round58-ui.test.ts`: actual mixed-move quarantine reproduction, bulk matrix, Undo.
- `test/drive-review-round54-boundaries.test.ts`: expanded whole-client two-shape matrix.
- `test/drive-review-round57.test.ts`: principal/origin regression reads the authorization through its typed principal accessor, independent of transplanted rule labels.
- `test/drive-mergegate-round3.test.ts`, `test/drive-mergegate-round11.test.ts`, `test/drive-wac-pod.ts`: legacy policy-preservation assertions compare complete typed authorization clauses independently of local rule subjects and the transplantation implementation.
- `test/drive-safety.test.ts`: replaces an older expectation that adopted a fresh comparison GET with refusal and preservation of recovery; read-only pending reconciliation still compares bytes without destructive identity proof.
- `test/drive-review-round55-ui.test.ts`, `test/drive-gate-regressions.test.ts`: wrappers preserve the required merge destination receipt, including the test that deliberately omits its optional source receipt.
- `test/drive-review-round58-audit.md`: this audit and finding/test mapping.

No dependencies were added. Playwright is skipped as requested. Changes remain uncommitted.

## Validation

Executed from `apps/suite` with `PATH=/opt/node24/bin:$PATH`, without network access:

- Full `npx vitest run --coverage` (with additional report-on-failure/JSON reporters for diagnosis): 263 files and 12,476 tests passed. The JSON summary confirms all 481 configured files individually have 100% statements, branches, functions, and lines; no file is below a threshold.
- After adding the three index-warning UI variants, the final focused UI run passed all 155 tests in `drive-review-round58-ui.test.ts`, `drive-interactions-ui.test.ts`, `drive-mergegate-round21-ui.test.ts`, and `drive-mergegate-round22-ui.test.ts`. These UI files do not alter the configured library coverage globs.
- `npx tsc --noEmit -p .`: passed on the final changes.
- `npx biome check src test`: passed on the final changes with 72 existing warnings and no errors.
- `git diff --check`: passed.

The separate Drive-only run also passed all 3,931 tests across 97 files. Initial failed runs and isolated baseline reproductions were used to verify the regressions before the final passing runs. No commits were created, and unrelated font changes were left untouched.
