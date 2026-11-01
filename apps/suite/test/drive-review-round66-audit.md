<!-- AUTHORED-BY Codex -->
# Drive review round 66

Changes remain in the working tree; no commits, dependency changes, package changes,
font changes, network access, or localhost listeners. Paths below are relative to
`apps/suite`.

## Findings and regression tests

| Finding | Class and correction | Regression in `test/drive-review-round66.test.ts` unless specified |
| --- | --- | --- |
| Final parent HEADs omit ACL assertions | Supplemental resource identities lost captured discovery. `ResourceAssertion` requires a synchronous endpoint assertion at the final HTTP boundary, including protected-resource guards for ACL writes. Parent preparation captures discovery with its validator; final writes also check the existing access binding and scope. | `round 66: Move asserts parent discovery on the final parent HEAD before a child mutation`; corresponding `Copy` and `remove` cases. They assert no child mutation, preserved source bytes, no anonymous destination secret, and an untouched foreign ACL. |
| Quarantine clears after observing a public backup endpoint | The same identity projection omitted backup assertions. `quarantine` supplies its captured recovery/backup bindings to every final backup HEAD before clearing the original. | `round 66: quarantine asserts backup discovery before clearing the original (replay failure: false)`. The original remains populated, backup remains discoverable in the reported failure, and Drive never rewrites the foreign ACL. |
| Recovery deletion ignores changed survivor discovery | The same projection omitted scoped survivor assertions. `remove` binds survivor assertions before deletion; `deleteVersion` preserves them and original ancestor assertions through version transitions and into `deletionControl.remove`. | `round 66: partial file Restore asserts final survivor discovery before deleting its private recovery`; corresponding `folder` case. No recovery DELETE occurs after changed discovery; the private recovery remains. |
| Repeated overwrite/replay and partial-Restore survivor findings | Both are covered by the same mandatory resource assertion boundary, without a second special-case recovery algorithm. | The quarantine test with `replay failure: true` forces verification and replay failures. Both partial-Restore tests cover the repeated survivor report. |
| Details snapshots no longer reconcile | Target ownership and listing metadata had been conflated. User selection/navigation owns target choice; refreshed raw listings reconcile current Details and Preview snapshots through `reconcileItem`. Successful Rename/Move/Undo/Restore retarget existing Details before listing invalidation; a vanished listing target is pruned. | In `test/drive-review-round66-ui.test.ts`: `round 66: multi-selection Details reconciles replacement sizes with unchanged selected URLs`; `round 66: Details follows successful $operation (selected: $selected)` covers unselected Rename/Move and selected Rename, checking title, access, and technical address. |

The supplemental identity audit also found the same capture-replacement class in
recursive deletion: a fresher parent preflight could replace the original
ancestor's discovery. `deleteSnapshot` now transports its original assertion as
well as its ETag. Regression: `round 66: recursive removal never replaces its
captured ancestor endpoint with a fresher parent preflight`.

A separate shape (a) instance was found in `guardedWrite`: a later Drive operation's
atomic child-write receipt could replace an already approved folder overwrite
validator. Payload PUTs now preserve their supplied If-Match verbatim. Atomic
parent receipts still advance ancestor guards inside tree operations. Regression:
`round 66 shape a: a later Drive child write cannot replace the approved folder
overwrite validator`. It confirms an overwrite, performs another logical Drive
child upload, and requires the old overwrite to fail with 412 without a folder PUT.

The archived-original policy comparison was already correct in `client.bindAccess`
and `mergeContainer`; it remains unchanged. The new file/folder cases `round 66:
unchanged shared %s Restore compares the archived original after refused Trash
DELETE` prove an unchanged shared original finishes restoring and retires its
owner-only recovery copy.

## Both irreversible-step shapes

`test/drive-review-round54-boundaries.test.ts` runs both round-66 tables over all
54 step variants below. Shape (a) replaces the resource or ACL at the conditional
identity check, then proves Drive preserves that replacement. Shape (b) records
IndexedDB and Web Lock work alongside HTTP requests, then requires every
destructive request's preceding event to be the final conditional identity HEAD.
The helper accepts hydrated request data and synchronous assertions; persistence,
policy reads, callbacks, and identity proof hydration run before its final raw
HTTP checks. No additional local await was inserted after those checks.

| Steps covered by both tables |
| --- |
| Trash index overwrite; Move; Rename; Trash; remove; recursive remove; Delete forever; Empty Trash; overwrite; folder metadata |
| Restore; partial file Restore; partial folder Restore; Copy payload; ACL overwrite; replacement rollback; Upload rollback; new folder rollback; Copy rollback; container rollback |
| Metadata undo; policy archive cleanup; receipt cleanup; slot cleanup; ancestor cleanup; owner-only ACL; owner-only overwrite; owner-only folder overwrite; private folder ACL; protection receipt repair |
| Retained recovery clearing; replay recovery clearing; container merge; partial folder Restore metadata; Copy rollback without Link; container rollback without Link; folder overwrite rollback with child defaults; partial Restore rollback with child defaults; inherited replacement rollback; container provisioning ACL |
| Metadata undo recovery clearing; post-retirement private backup ACL; Move tree; Rename tree; Trash tree; Restore tree; Delete forever tree; Empty Trash tree; Replace completion recovery clearing; Move completion recovery clearing; Copy completion recovery clearing |
| Shared partial file Restore; shared partial folder Restore; verification and replay failure clearing (new variants this round) |

Existing two-shape coverage in `drive-review-round57-boundaries.test.ts` checks
confirmation-to-preflight replacement for twelve operation types. Protection
Delete's file/folder matrices in `drive-review-round62-ui.test.ts`, root/index/
description matrices in `drive/root.test.ts`, and Undo/dialog/upload-confirmation
regressions remain active.

## Every audited call site

| Path under `src/apps/drive/` | Call sites and invariant checked |
| --- | --- |
| `lib/client/commit.ts` | `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; target, policy, additional resource and ACL protected-resource guards; `Compensation.arm`, `disarm`, `rollback`; synchronous effects before later I/O. Additional resource and protected-resource guards now require `ResourceAssertion`. |
| `lib/client/client.ts` | `finalIdentity`, `checkResourceIdentity`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`, `verifySnapshotIdentity`; file/folder `snapshot`, `stat`, `listing`, `readVersion`, `readRdf`. Captures are verified rather than refreshed. |
| `lib/client/client.ts` | `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`; scoped bindings remain available to supplemental final HEAD assertions. |
| `lib/client/client.ts` | `guardedWrite`, previous-version GET, final parent/target checks, both compensation branches; `write`, `rawPut`, `replayProtected`, `replayOrQuarantine`, `quarantine` backup writes, clearing, and completion. Payload preconditions remain immutable; quarantine checks captured backup discovery before clearing. |
| `lib/client/client.ts` | `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, direct/recursive `remove`; provisioner cleanup, Upload cleanup, tree deletion, file/folder Copy rollback and direct removal callers of `deleteVersion`. Ancestor and survivor assertions survive mapping; committed deletions disarm compensation before ledger retirement. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`; destination capture, `verifyDestination`, `bindDestination`, `verifyAccess`, `rollback`, `secureRetained`; post-retirement source/destination completion. Conditional cleanup never adopts a replacement's validator or ACL. |
| `lib/client/client.ts` | `mergeContainer`, `verifyMerge`, metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; public `exclusive` and write/copy/move/remove wrappers. Partial Restore compares archived original policy while retaining current survivor endpoint assertions. |
| `lib/client/access.ts` | `discover`, `verifyEndpoint`, `captureEndpoint`, `snapshot`, `read`, `effective`, `checkOwn`, `ownAccessGuards`; `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured source validation, conditional creation acceptance, `identities`, `verifyEndpoint`, `installed`, `recheck`, `retire`, `rollback`, destination receipts/policy; `accessGains`, `intersectAccess`, `projectAccess`, `materializeAccess`, `retargetAccess`. ACL writes remain conditional against captured own policy or absence. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. Required ledger/serialization/lock work precedes final HTTP checks; cleanup preserves foreign resources and ACLs. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; durable intent before the final checks, conditional DELETE, definitive refusal and ambiguous settlement, compensation retirement before later bookkeeping. Survivor identities now require endpoint assertions. |
| `lib/client/container-versions.ts`, `cleanup.ts` | `track`, `prepare`, `current`, `identity`, `committed`; `identity` now preserves assertions, and `prepare` returns assertions with its captured endpoints. Only atomic mutation receipts explain parent transitions. `discardVersion`, `ownsEmptyContainer` keep approved validators on refused cleanup. |
| `lib/client/protection-ledger.ts`, `source-operations.ts` | Protection/deletion ledger reads/writes/migration/retirement; `sourceOperation`, Web Lock acquisition/release, explicit held scopes. None intervene after the final commit-boundary identity HEAD. |
| `lib/operations/operations.ts` | `uploadFile` fail/Replace/Keep both, `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`; `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`; `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`. Confirmed versions remain pinned through retries; absent caller versions are captured at operation preflight. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` folder merge, duplicate file/folder removal, unsettled Copy and settled Move; `restoreItems`, `restoreItemsUnlocked`; `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Recovery survivors reach the same final endpoint assertion boundary. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, root marker, description marker, Type Index registration, initialization/resume. Captured conditional validators and synchronous discovery assertions remain in use. |
| `state/ui.tsx`, `state/undo.ts` | Dialog/toast snapshots, `refreshAfter`, Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash and source Delete actions; `moveWithValidator`, tree guards, reverse-move identity transport, `errorMessage`, `reportFailure`. New `retargetDetails` and successful refresh callbacks update targets before invalidation, including Undo. |
| `state/uploads.ts`, `state/resource.ts` | `pump`, `resolve`, Retry, Replace conflict-target capture/renewal; `withHydratedMetadata`, `useLiveItem`, `useLiveResource`, `useResourceVersion`. No refreshed validator substitutes for a captured confirmation. |
| `components/dialogs.tsx`, `protection-banner.tsx`, `views.tsx` | Rename/Move/Trash confirmation hydration, protection Delete capture, Delete forever/Empty Trash entry snapshots and batch operations. |
| `components/file-browser.tsx`, `item-menu.tsx`, `preview.tsx`, `details.tsx`, `upload-dock.tsx` | `reconcileSelection`, selection dispatch, explicit Details openers, listing Details/Preview reconciliation, successful relocation targets, loaded-file validators, metadata/access streams, upload decisions and errors. Same-URL refreshes update metadata; only actual user selection/navigation takes target ownership. |

Solid still permits another client to change access/content between requests.
Drive's conditional requests and completion checks surface that accepted residual.
Observed disagreement stops the next irreversible step, retains recovery, and
reports failure. Rollback never rewrites the foreign ACL or adopts foreign content
validators to clear another client's representation.

## Reproduction and validation

Final functional/UI regression tests were replayed against original `HEAD` source
in isolated `/tmp/drive66-before`; the working tree was never replaced:
**13 failed, 2 passed** across 15 cases. Every newly fixed scenario fails before
its fix; the two unchanged shared-original Restore cases pass.

Final required checks from `apps/suite`, with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **278 files, 12,802 tests passed**, exit 0. All
  **481 configured source files** individually have **100% statements, branches,
  functions, and lines**. Coverage configuration and thresholds are unchanged.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

No network or localhost ports were used. Playwright was skipped as requested.
No build/font workaround was needed or applied.

## All changed paths

The missing-final-discovery class changes:

- `src/apps/drive/lib/client/commit.ts`
- `src/apps/drive/lib/client/container-versions.ts`
- `src/apps/drive/lib/client/client.ts` (also the immutable overwrite-validator fix)
- `src/apps/drive/lib/client/deletion.ts`

The stale-Details target/metadata class changes:

- `src/apps/drive/components/file-browser.tsx`
- `src/apps/drive/state/ui.tsx`

Regression, invariant, and audit documentation:

- `test/drive-review-round66.test.ts`
- `test/drive-review-round66-ui.test.ts`
- `test/drive-container-versions.test.ts`
- `test/drive-review-round54-boundaries.test.ts`
- `src/apps/drive/lib/client/README.md`
- `test/drive-review-round66-audit.md`
