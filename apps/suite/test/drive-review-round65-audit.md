<!-- AUTHORED-BY Codex -->

# Drive review round 65

Paths are relative to `apps/suite/`. Changes remain uncommitted on `claude/DRV-04`.
No dependencies, SDK packages, fonts, coverage globs or thresholds were changed.

## Findings, classes, changed paths and regression tests

| Finding / class | Fix and every changed path for the class | Regression |
| --- | --- | --- |
| Both medium ACL findings: a matching content ETag does not identify the associated ACL endpoint; completion and destination HEADs omitted the captured assertion. | `src/apps/drive/lib/client/client.ts`: `checkResourceIdentity` requires a synchronous captured-header assertion for every content identity HEAD. `guardedWrite` shares one assertion between the mutation boundary and completion, before disarming compensation. Move's `verifyDestination` checks discovery before source deletion and after retirement; Copy's final checks also assert the binding. Disagreement enters the existing conditional rollback/private evacuation paths, retaining confidential bytes and preserving the concurrent ACL. The same invariant now applies to file/folder snapshots, rollback source proofs, merge/source-ancestor guards, partial-Restore survivor proofs, demo retention, and private-backup completion. `src/apps/drive/lib/client/README.md` documents the invariant. `test/drive-wac-pod.ts` shares a configurable resource-to-ACL association between HTTP discovery, signed-out enforcement and auxiliary deletion. `test/drive-review-round65.test.ts` covers these checks. `test/drive-review-round54-boundaries.test.ts` extends both mutation-shape tables to the completion recovery paths. This audit records all paths. | `round 65: $step $kind rejects changed ACL discovery at $phase (404 hides Link: $hiddenLink)` — Replace/Move/Copy, file/folder, visible/hidden 404 Link, write completion, pre-delete destination check and operation completion (24 cases). Assertions require refusal, no source deletion before the pre-delete check passes, untouched foreign ACL, no unsafe destination DELETE, no anonymously readable confidential payload, and private recoverable bytes. Also `source snapshot refuses changed discovery on its conditional %s HEAD before copying` (file/folder), `partial Restore checks the survivor's captured endpoint after recovery deletion`, and `private evacuation checks backup discovery on its completion HEAD`. |
| Medium Details finding: listing-array identity was mistaken for a selection change, overwriting an explicitly opened target. | `src/apps/drive/components/file-browser.tsx`: the shared Details synchronization compares selected URLs and folder identity. Refreshed row arrays preserve the explicitly opened target; actual selection changes, clearing and navigation still update Details. `test/drive-review-round65-ui.test.ts` covers keyboard and item-menu opening. | `round 65: Details opened by %s on an unselected file survives an upload listing refresh` — focus an unselected private file, open Details by `d` or the real item-menu action, upload through the real Drive client/WAC pod, refresh the listing, and require the same target, heading and access summary. Selecting the upload and clearing it still update Details. Both cases fail before the fix. |
| Low Move-tree finding: collapsing an ancestor leaves the roving target inside hidden content. | `src/apps/drive/components/dialogs.tsx`: collapse retargets a hidden descendant to the collapsed ancestor. `focusTarget` is shared by collapse and arrow/Home/End navigation. Loading is outside the state updater. `test/drive-review-round65-ui.test.ts` covers parent and root collapse. | `round 65: collapsing the %s of the selected Move descendant retargets its sole Tab stop and focus` — select Parent/Child, collapse Parent or My Drive, require exactly one tree Tab stop on the selected/focused ancestor, then reopen with ArrowRight. Both cases fail before the fix. |
| Partial Restore must compare archived original sharing rather than owner-only recovery sharing. | Existing `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, `bindAccess` and `mergeContainer` already retain this invariant. No source change was needed. `test/drive-review-round65.test.ts` adds explicit file/folder regressions. | `round 65: partial Restore compares archived shared %s access after refused Trash DELETE` — public original, owner-only Trash recovery, refused original DELETE, then successful Restore preserving original sharing and removing the recovery copy. These cases pass before and after the changes. |

## Every changed client identity-check path

All these call sites now use `checkResourceIdentity`; raw `checkIdentity` remains
only inside that helper and for policy-archive content/presence guards:

1. `guardedWrite`: final PUT completion, using exactly the commit assertion;
   includes Replace, payload writes, metadata writes and protected replay.
2. `snapshot`: final file HEAD and final folder HEAD after recursive capture.
3. `verifySnapshotIdentity`: rollback's independent source proof.
4. `secureRetained`: explicit demo retention identity proof.
5. `mergeContainer.verifyMerge`: recovery source and source-ancestor checks.
6. `transfer.verifyAccess`: approved source-ancestor identity checks.
7. `transfer.verifyDestination`: initial destination verification, each source's
   pre-delete verification after persistence, and post-retirement completion.
8. `transfer`: Copy's final file/container PUT-receipt checks.
9. `remove`: compared recovery identity proof before survivor checks.
10. `remove`: surviving identities after recovery DELETE and ledger retirement.
11. `quarantine`: every privately saved backup identity after exposed-content
    clearing and all access/ledger work.

No additional recheck request was inserted between a final identity HEAD and its
irreversible request. Header assertions are synchronous and use captured inputs.

## Both irreversible-step shapes

`drive-review-round54-boundaries.test.ts` has **51 steps × two shapes = 102 cases**.
Shape (a) replaces the approved version at its final HTTP check and requires the
replacement to survive. Shape (b) records real IndexedDB and Web Lock work and
requires every destructive request to follow a conditional HTTP identity HEAD
directly. The final three steps are new completion-error recovery paths:

1. Trash index overwrite
2. Move
3. Rename
4. Trash
5. remove
6. recursive remove
7. Delete forever
8. Empty Trash
9. overwrite
10. folder metadata
11. Restore
12. partial file Restore
13. partial folder Restore
14. Copy payload
15. ACL overwrite
16. replacement rollback
17. Upload rollback
18. New folder rollback
19. Copy rollback
20. container rollback
21. metadata undo
22. policy archive cleanup
23. receipt cleanup
24. slot cleanup
25. ancestor cleanup
26. owner-only ACL
27. owner-only overwrite
28. owner-only folder overwrite
29. private folder ACL
30. protection receipt repair
31. retained recovery clearing
32. replay recovery clearing
33. container merge
34. partial folder Restore metadata
35. Copy rollback without Link
36. container rollback without Link
37. folder overwrite rollback with child defaults
38. partial Restore rollback with child defaults
39. inherited replacement rollback
40. container provisioning ACL
41. metadata undo recovery clearing
42. post-retirement private backup ACL
43. Move tree
44. Rename tree
45. Trash tree
46. Restore tree
47. Delete forever tree
48. Empty Trash tree
49. Replace completion recovery clearing
50. Move completion recovery clearing
51. Copy completion recovery clearing

`drive-review-round57-boundaries.test.ts` also exercises confirmation-to-preflight
replacement and local-work ordering for Replace upload, ACL overwrite, source
DELETE, Move, Rename, Trash, Restore, partial Restore, recovery DELETE, Delete
forever, Empty Trash and container merge (24 cases). Protection Delete's
file/folder matrices, root index/container/description matrices, Undo, dialog and
upload-confirmation tests remain active. These all pass in the full suite.

The existing shared `commitHttp` boundary already accepts hydrated request data,
checks captured policy/resource identities after callbacks and persistence, then
issues the request. Its response classification disarms committed compensations
before ledger retirement. No validator-refresh or local-await violation was found
in this pass; that boundary needed no additional source changes.

## Every audited call site

| Path under `src/apps/drive/` | Audited call sites |
| --- | --- |
| `lib/client/commit.ts` | `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; target, policy and protected-resource identities; `Compensation.arm`, `disarm`, `rollback`; synchronous commit effects and conditional request construction. |
| `lib/client/client.ts` | `checkResourceIdentity`, `stat`, `listing`, `readVersion`, `readRdf`, file/folder `snapshot`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`, `verifySnapshotIdentity`; `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`. |
| `lib/client/client.ts` | `guardedWrite` and both compensation branches; `write`, `rawPut`, `replayProtected`, `replayOrQuarantine`, `quarantine` (backup writes, conditional clearing and completion); `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, file/recursive `remove`. All six `deleteVersion` callers: provisioner cleanup adapter, Upload cleanup, tree deletion, folder Copy rollback, file Copy rollback and direct removal. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`, destination capture, `verifyDestination`, `bindDestination`, `verifyAccess`, `rollback`, `secureRetained`; source retirement and survivor completion; `mergeContainer`, `verifyMerge` and metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; public `exclusive`, write/copy/move/remove wrappers. |
| `lib/client/access.ts` | `discover`, `verifyEndpoint`, `captureEndpoint`, `snapshot`, `read`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured-source validation, conditional creation acceptance, `identities`, `verifyEndpoint`, `destinationOwn`, `destinationPolicy`, `installed`, `recheck`, `retire`, `rollback`; `accessGains`, `intersectAccess`, `projectAccess`, `materializeAccess`, `retargetAccess`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`; conditional ACL writes and empty-placeholder cleanup. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; durable intent before checks, conditional DELETE, definitive refusal, ambiguous settlement, post-commit persistence. |
| `lib/client/container-versions.ts`, `cleanup.ts` | `track`, `prepare`, `current`, `identity`, `committed`; only Drive's own atomic mutation receipts advance approved parent identities. `discardVersion`, `ownsEmptyContainer`; refused cleanup never adopts the replacement validator. |
| `lib/client/protection-ledger.ts`, `source-operations.ts` | Protection/deletion read/write/clear, migration and retirement; `sourceOperation`, Web Lock acquisition/release and explicit held scopes. All hydration precedes the final HTTP boundary. |
| `lib/operations/operations.ts` | `uploadFile` (fail/Replace/Keep both), `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`; `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`; `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` (folder merge, duplicate file/folder removal, unsettled Copy, settled Move); `restoreItems`, `restoreItemsUnlocked`; `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Approved recovery/root validators survive stale-descendant retries. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, root/description marker writes, Type Index registration, initialization/resume; captured validators and endpoint assertions. |
| `state/ui.tsx`, `state/undo.ts` | Dialog snapshots; `refreshAfter`; Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash and source-delete actions; Undo callbacks, `moveWithValidator`, tree validation and identity transport; `errorMessage`, `reportFailure`, retained recovery locations. |
| `state/uploads.ts`, `state/resource.ts` | Replace conflict-target capture, `pump`, `resolve`, Retry and renewed confirmation; `withHydratedMetadata`, `useLiveItem`, `useLiveResource`, `useResourceVersion`. |
| `components/dialogs.tsx`, `protection-banner.tsx`, `views.tsx` | Rename/Move/Trash-confirm dialog captures, disclosure and arrow-key tree navigation; displayed protection Delete validator; Delete forever/Empty Trash entry snapshots and batch actions. |
| `components/file-browser.tsx`, `item-menu.tsx`, `preview.tsx`, `details.tsx`, `upload-dock.tsx` | Selection reconciliation and Details synchronization; keyboard, item-menu and preview Details targets; preview reconciliation and loaded-file validator; metadata/access revalidation; upload conflict decisions and errors. |

The accepted Solid limitation remains concurrent changes between separate
requests. Drive uses captured conditional validators, stops on observed content or
endpoint disagreement, preserves recovery, reports failure, and does not adopt a
foreign validator to revert another client's ACL or content.

## Reproduction and validation

The new functional and UI tests were executed before their respective fixes.
Their final versions were also replayed with original `HEAD` source in isolated
`/tmp/drive65-before`: **24 failed, 10 passed** across 34 cases. The failures cover
every reported finding, source snapshot assertions, post-delete partial-Restore
survivor assertion and private-backup completion. The ten already-correct cases
are shared file/folder partial Restore and intermediate Copy/Move write completion
that a later check already rejected. Working-tree source was never replaced.

Final checks from `apps/suite`, with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **276 files, 12,781 tests passed**, exit 0. All
  **481 configured source files** individually have **100% statements, branches,
  functions and lines**. Coverage globs and thresholds are unchanged.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

No network or localhost ports were used. Playwright was skipped as requested.

## Complete changed paths

```text
src/apps/drive/components/dialogs.tsx
src/apps/drive/components/file-browser.tsx
src/apps/drive/lib/client/client.ts
src/apps/drive/lib/client/README.md
test/drive-review-round54-boundaries.test.ts
test/drive-review-round65.test.ts
test/drive-review-round65-ui.test.ts
test/drive-review-round65-audit.md
test/drive-wac-pod.ts
```
