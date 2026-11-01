<!-- AUTHORED-BY Codex -->

# Drive round 63 audit

Paths in this document are relative to `apps/suite/`. Changes stay within this
application. No dependencies, packages, fonts, commits, network access, browser
servers, or Playwright runs are involved.

## Findings and shared fixes

| Finding and class | Every changed source path and behavior | Regression |
| --- | --- | --- |
| Medium: origin-only WAC grants disappear from audience comparisons. Class: treating application authorization as a condition on principal clauses rather than an independently comparable permission. | `src/apps/drive/lib/client/access.ts`: `accessGains` includes independent application clauses from every authorization, including origin-only rules; public/authenticated principal grants cannot cover an application permission. The same comparison governs Move confirmation, access-binding rechecks, Restore, owner-only protection, and recovery intersection. `intersectAccess` preserves permitted origin-only grants and drops unapproved application permissions. Projection, materialization, and retargeting already preserve origins. | `drive-review-round63.test.ts`: `separate origin grants require $kind Move confirmation (404 hides Link: $hiddenLink)` (file/folder × exposed/hidden 404 Link); `origin permissions compare independently of principal clauses and mode unions`; `recovery intersection retains only captured application permissions (permitted: %s)` (allowed/denied). Existing `drive-access.test.ts` now expects the independent application permission alongside the conditional principal label. |
| Medium: rollback DELETE can remove a different, concurrently installed ACL. Class: checking the captured ACL document and body ETag without checking the resource-to-ACL association at the final HTTP boundary. | `src/apps/drive/lib/client/commit.ts`: `CommitChecks.verifyHeaders` is synchronous (`undefined`, never a promise), runs against the final target HEAD, and accepts already captured inputs. `src/apps/drive/lib/client/access.ts`: one `verifyEndpoint` invariant is used by ACL writes and cleanup. `src/apps/drive/lib/client/ancestors.ts`: provisioning cleanup supplies its captured endpoint; protection verification shares the invariant. `src/apps/drive/lib/client/client.ts`: standalone creation rollback and transfer rollback for both files and containers supply the captured endpoint. A mismatch stops DELETE; existing private evacuation retains payloads and leaves the concurrent ACL untouched. All four cleanup call sites are covered. | `drive-review-round63.test.ts`: `$step rollback preserves a concurrently discovered ACL (404 hides Link: $hiddenLink)` (Upload, Copy, folder Copy, New folder × exposed/hidden 404 Link). The fixture models a server deleting the discovered associated ACL with its resource; assertions require that ACL to survive, forbid target DELETE, and verify private retained file bytes. |
| Medium: removing Undo while the toaster survives loses focus. Class: a removable control lives outside the app's focus ownership boundary. | `src/apps/drive/components/drive-app.tsx`: Toaster is inside `DriveFocusBoundary`, so all toast actions participate in its existing removal recovery. | `drive-review-round63-ui.test.ts`: `keyboard Trash Undo returns focus when its toast action disappears`, using the real Toaster and WAC transport; the restored notification remains mounted and focus returns to the listing. |
| Low: Cancel restores focus behind Navigation. Class: fallback focus ignores hidden ancestors and surviving modal ownership. | `src/apps/drive/state/ui.tsx`: shared `isDriveFocusTarget` rejects disabled/disconnected/hidden/inert/aria-hidden targets and hidden ancestor styles; `focusDriveListing` restricts candidates to a surviving modal and then its usable controls. `src/apps/drive/state/app-focus.tsx`: shares visibility and modal recognition, observes aria-hidden changes, and uses the modal-aware fallback for control removal. Radix Sheet/Dialog slots are recognized because those modal components do not emit aria-modal; popovers remain distinct. | `drive-review-round63-ui.test.ts`: `cancelling New folder inside Navigation restores focus within the surviving modal`, at 768px with the actual drawer, New menu, and Cancel button. It requires focus inside the drawer and outside any hidden/inert ancestor. |
| Partial Restore must compare the archived shared original, not owner-only recovery. | Existing `client.bindAccess`, `recoveryPolicy`, `preparePolicies`, and `mergeContainer` already use the captured original archive. No source change is necessary. | Added `drive-review-round63.test.ts`: `partial Restore compares the archived shared %s after refused Trash DELETE` (public file and folder with a shared child). Both pass before and after this round. |

## Both irreversible-step shapes

The final mutation request retains the selected/preflight validator or a receipt
of Drive's own committed mutation. Later reads only verify it. Container versions
advance only from atomic receipts of Drive's own child mutations. A refused request
never refreshes the identity to retry the same decision.

All local hydration, IndexedDB/protection/deletion ledger work, Web Locks,
serialization, callbacks, and recovery preparation precede `commitHttp`'s raw final
HTTP checks. The added header assertion is synchronous and does not add a request
or asynchronous work between the final HEAD and the mutation. Successful mutations
disarm compensation before ledger retirement or other fallible bookkeeping.

`drive-review-round54-boundaries.test.ts` now has **42 steps × two shapes**:
validator replacement at the final identity check and IndexedDB/Web Lock ordering.
This round adds Upload rollback and New folder rollback. The complete table is:

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

`drive-review-round57-boundaries.test.ts` additionally covers selection-to-preflight
replacement and local-work ordering for 12 operation types. The protection Delete
file/folder matrices in `drive-review-round62-ui.test.ts` and three root-write
matrices in `drive/root.test.ts` remain active, giving 47 distinct step variants
covered for both shapes across those tests. Missing-validator protection Delete,
Undo, dialogs, Replace, Delete forever, and Empty Trash retain their UI captures.

## Every audited call site

| Path under `src/apps/drive/` | Call sites audited |
| --- | --- |
| `lib/client/commit.ts` | `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; compensation `arm`, `disarm`, `rollback`; synchronous target and protected-resource header guards. |
| `lib/client/access.ts` | `discover`, `verifyEndpoint`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured-source validation, conditional creation acceptance, `identities`, `destinationOwn`, `destinationPolicy`, `installed`, `recheck`, `retire`, `rollback`; `accessGains`, `intersectAccess`, `projectAccess`, `materializeAccess`, `retargetAccess`. |
| `lib/client/client.ts` | `captureResource`, `checkContainerVersion`, `requireOwnReceipt`, `captureOwnAccess`, `createdOwnAccess`, `stat`, `readVersion`, `readRdf`, file/folder `snapshot`, `capturedAccess`, `verifySnapshotIdentity`, transfer destination capture, `verifyDestination`. |
| `lib/client/client.ts` | `guardedWrite` and both compensation branches; `write`, `rawPut`, `replayProtected`, `replayOrQuarantine`, `quarantine`, private-backup retention/conditional clearing, `createFolder`, `prepareTrash`. |
| `lib/client/client.ts` | `deleteVersion`, `deleteSnapshot`, `remove`; `copySnapshot`, `transfer`, `copy`, `move`, `rollback` (file/container branches), `secureRetained`; survivor verification after retirement and private preservation; `mergeContainer`, metadata compensation, `verifyMerge`; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, `bindDestination`, public `bindAccess`, `exclusive`, public write/copy/move/remove wrappers; scope rechecks/retirement/compensation selection. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. |
| `lib/client/container-versions.ts` | `track`, `prepare`, `current`, `identity`, `committed`; later reads never advance approved parent identities. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; deletion-intent persistence before final HTTP checks; compensation disarm before retirement. |
| `lib/client/cleanup.ts` | `discardVersion`, `ownsEmptyContainer`; refused deletion probes are read-only and cannot authorize a new version. |
| `lib/client/protection-ledger.ts`, `source-operations.ts` | Protection/deletion ledger get/set/clear/migration/retirement; `sourceOperation`, lock acquisition/release. |
| `lib/operations/operations.ts` | `uploadFile` (fail/Replace/Keep both), `renameItem`, `moveItems`, `copyItem`, `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `markRecovery`, `reconcilePending`, `listTrash`, `trashItems`, `trashItemsUnlocked`, `runTrash`, `requireTrashEntry`, `removeCompletedRecords`. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`, `restoreMissing` (folder merge, duplicate file/folder deletion, unsettled Copy, Move), `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, root marker/description marker writes, Type Index registration, conditional creation receipt, initialization/resume. |
| `state/ui.tsx` | `openDialog`, `refreshAfter`, Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash/source-delete actions; Undo callbacks, `reportFailure`, `errorMessage`, recovery locations; `focusDriveListing`, `captureDriveFocusRemoval`, dialog/details focus restoration. |
| `state/undo.ts`, `state/uploads.ts`, `state/resource.ts` | `moveWithValidator`, reverse-tree checks and conditional transport; conflict validator capture, `pump`, `resolve`, Retry; resource/preview metadata hydration. |
| `components/protection-banner.tsx`, `dialogs.tsx`, `views.tsx`, `file-browser.tsx`, `preview.tsx`, `upload-dock.tsx` | Displayed protection Delete identity; dialog snapshots; Delete forever and Empty Trash entry snapshots; row/selection command identity, preview reconciliation/loaded-file receipt, upload errors and conflict decisions. |
| `components/drive-app.tsx`, `state/app-focus.tsx`, `state/listing-focus.ts` | Toaster ownership, document/portal focus capture, removal observer, modal and visibility fallback, listing/row removal restoration. |

The accepted Solid concurrency limitation remains: another client can mutate
between separate requests. Drive conditionally mutates only captured content or
ACL versions, stops on observed changes, preserves recovery, and reports the
change. It never adopts a foreign validator to revert another client's ACL or
payload. The new endpoint assertion uses the final HEAD already present instead
of adding another discovery request.

## Reproduction and validation

Final functional tests were replayed against original `HEAD` source in an isolated
`/tmp/drive63-before` tree: **16 failed, three passed**. This reproduces every
reported finding, plus origin-intersection loss. The three already-correct cases
are shared file/folder partial Restore and refusal of an unapproved recovery
origin. Working-tree source was never replaced during this baseline run.

Final validation, from `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage --coverage.reportOnFailure`: **272 files, 12,677 tests
  passed**, exit 0. All **481 configured source files** have **100% statements,
  branches, functions, and lines** individually. Coverage globs and thresholds
  are unchanged. The report-on-failure option only ensures diagnostics are emitted
  on a failed run; the final run passed.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.
- Targeted final UI rerun: two tests passed. The strengthened tablet test selects
  the active portalled menu item; both final UI cases also fail against original
  `HEAD`. Functional regressions: 17 cases, including both shared partial Restores
  and allowed/denied origin intersection. Boundary matrix: 84 cases across 42 steps.

Complete changed paths:

```text
src/apps/drive/components/drive-app.tsx
src/apps/drive/lib/client/README.md
src/apps/drive/lib/client/access.ts
src/apps/drive/lib/client/ancestors.ts
src/apps/drive/lib/client/client.ts
src/apps/drive/lib/client/commit.ts
src/apps/drive/state/app-focus.tsx
src/apps/drive/state/ui.tsx
test/drive-access.test.ts
test/drive-review-round54-boundaries.test.ts
test/drive-review-round63-audit.md
test/drive-review-round63-ui.test.ts
test/drive-review-round63.test.ts
```

No commit was created. Changes remain in the working tree on `claude/DRV-04`.
Playwright was skipped because this sandbox cannot bind localhost ports, as requested.
