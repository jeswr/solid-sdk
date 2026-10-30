<!-- AUTHORED-BY Codex -->

# Drive review round 64

All paths below are relative to `apps/suite`. No dependencies, coverage globs,
thresholds, shared SDK packages, fonts, or generated assets were changed. No commit
was created.

## Findings and classes

| Finding / class | Fix and every changed source path | Regression |
| --- | --- | --- |
| Medium: a matching representation ETag does not identify its ACL endpoint. Normal deletion omitted the final synchronous discovery assertion used by rollback. | `src/apps/drive/lib/client/access.ts`: shared `captureEndpoint` captures discovery, including absence, and checks it synchronously; deletion may recognize ACP endpoints without permitting ACP installation. `bindAccess.verifyEndpoint` asserts the original source/destination binding. `client.ts`: file/folder snapshots carry the assertion; `deleteVersion` requires it; `deleteSnapshot` and both branches of `remove` apply it together with scoped bindings. `stat` exposes its preflight headers internally without replacing a supplied validator. `ancestors.ts`: the cleanup callback type requires the assertion too. | `drive-review-round64.test.ts`: `… $step retains $kind recovery when the final HEAD changes ACL endpoint …`, 8 operations × file/folder × visible/hidden 404 Link = 32 cases. The race starts only after the durable deletion intent, so it changes the final conditional HEAD, after all access reads, with the same content ETag. The server fixture models DELETE also destroying the newly discovered auxiliary. |
| Same class: late discovery disagreement must preserve completed recovery without leaving a copied public audience after source revocation. | `client.ts`: `transfer` keeps completed recovery after access disagreement during deletion; `secureRetained` conditionally narrows non-Trash copies to owner-only, using the original destination ACL receipt or captured absence. If that fails, existing private evacuation retains bytes and conditionally clears only Drive's own representation. Trash retains its already-private copy. No concurrent source or destination ACL is adopted or reverted. | The same 32 cases assert refusal, original/recovery survival and preservation of the foreign ACL; Move/Rename also assert the retained destination is inaccessible anonymously, including folder names. |
| Same class found by the whole-client audit: overwrite and root metadata requests omitted final endpoint assertions. | `client.ts`: `guardedWrite` checks its standalone and scoped bindings; `replayProtected` and `mergeContainer` carry their captured endpoint into that boundary. `src/apps/drive/lib/model/root.ts`: `commitRoot` checks the index/root binding, and description PATCH retains discovery from its original GET. These callbacks are synchronous and add no recheck requests. | `drive-review-round64.test.ts`: `overwrite refuses a changed final ACL endpoint for a %s`, file/folder. `drive/root.test.ts`: `root %s refuses a changed endpoint on its final HEAD`, index/container marker/description marker. All five failed before their fix. |
| Recovery must have an owner before a late revocation can require privacy. | `client.ts`: transfer preflight resolves the explicit WebID or captured controller before moving non-demo resources. That same identity secures every retained child; a child's policy need not contain its own Control grant. | `drive-review-round64.test.ts`: `Move requires a captured private recovery owner before copying a shared %s`, file/folder; the main Rename cases also exercise a controller inferred from the original policy. |
| Medium: strict date-only metadata reading drops Unix `stat:mtime`. | `client.ts`: `itemFromResource` uses existing `DriveResource.modifiedAt` from `lib/model/model.ts`. Its typed `OptionalFrom` / `LiteralAs.number` fallback converts numeric seconds to milliseconds. Both listing and cached metadata consumers receive the same `DriveItem.modified`. No second date parser was introduced. | `drive-review-round64.test.ts`: `Unix stat:mtime populates Modified, date filters and Recent through the real WAC listing`. The actual RDF response contains Unix metadata without `dct:modified`; assertions cover its date, displayed Modified label, Today filter and Recent scan. |
| Low: mobile folder toolbar CSS hides unrelated Trash bulk commands. | `src/apps/drive/components/drive.css`: scope both nowrap and direct-button hiding to the Folder actions toolbar. Trash retains wrapping and both commands. | `drive-review-round64-ui.test.ts`: `Trash bulk commands remain visible and operate on both selected entries at %spx`, at 375, 767, 768 and 1024px. The real Trash view selects two rows; the actual stylesheet's CSSOM supplies applicable breakpoint rules; Restore and Delete forever receive both entries. |
| Partial Restore compares against the archived original shared policy. | Audited `client.bindAccess`, `recoveryPolicy`, `preparePolicies` and `mergeContainer`: they already compare the archived policy captured at trash time. Kept that behavior. | `drive-review-round64.test.ts`: `partial Restore accepts the archived shared %s after Trash DELETE was refused`, file and folder with shared child; both pass before the fix. Recovery is owner-only and the unchanged original remains shared after Restore. |

## Both irreversible-step shapes

`drive-review-round54-boundaries.test.ts` now runs **48 steps × 2 shapes = 96
cases**. This round adds real child-containing trees for Move, Rename, Trash,
Restore, Delete forever and Empty Trash. Shape (a) replaces a captured validator at
the final identity check and verifies that replacement survives. Shape (b) observes
real IndexedDB and Web Lock work and requires every destructive request to follow
the final conditional HTTP HEAD directly. Every request retains If-Match or
If-None-Match; hydration and callbacks remain ahead of the shared final boundary.

The 48 steps are Trash index overwrite; Move; Rename; Trash; remove; recursive
remove; Delete forever; Empty Trash; overwrite; folder metadata; Restore; partial
file Restore; partial folder Restore; Copy payload; ACL overwrite; replacement
rollback; Upload rollback; New folder rollback; Copy rollback; container rollback;
metadata undo; policy archive cleanup; receipt cleanup; slot cleanup; ancestor
cleanup; owner-only ACL; owner-only overwrite; owner-only folder overwrite; private
folder ACL; protection receipt repair; retained recovery clearing; replay recovery
clearing; container merge; partial folder Restore metadata; Copy rollback without
Link; container rollback without Link; folder overwrite rollback with child
defaults; partial Restore rollback with child defaults; inherited replacement
rollback; container provisioning ACL; metadata undo recovery clearing;
post-retirement private backup ACL; Move tree; Rename tree; Trash tree; Restore
tree; Delete forever tree; Empty Trash tree.

`drive-review-round57-boundaries.test.ts` separately exercises selection-to-preflight
replacement and local ordering across 12 operation types. Existing protection
Delete file/folder matrices in `drive-review-round62-ui.test.ts`, root mutation
matrices in `drive/root.test.ts`, Undo/dialog capture tests and replacement queue
tests remain active. Compensations still disarm inside the shared commit boundary
before fallible retirement or bookkeeping.

## Every audited call site

| Path under `src/apps/drive/` | Audited call sites |
| --- | --- |
| `lib/client/commit.ts` | `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; final target/resource/policy guards; `Compensation.arm`, `disarm`, `rollback`; synchronous commit effects. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; intent persistence, definitive refusal, ambiguous DELETE settlement and post-commit retirement. |
| `lib/client/access.ts` | `discover`, `verifyEndpoint`, `captureEndpoint`, `snapshot`, `read`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured-source checks, creation acceptance, `identities`, `verifyEndpoint`, `destinationOwn`, `destinationPolicy`, `installed`, `recheck`, `retire`, `rollback`; `projectAccess`, `materializeAccess`, `retargetAccess`, `accessGains`, `intersectAccess`. |
| `lib/client/client.ts` | `stat`, `listing`, `itemFromResource`, `readVersion`, `readRdf`, `snapshot`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`, `verifySnapshotIdentity`; `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`. |
| `lib/client/client.ts` | `guardedWrite` and both compensations; `write`, `rawPut`, `replayProtected`, `replayOrQuarantine`, `quarantine` including backup clearing; `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, file/recursive `remove`; all six `deleteVersion` callers: provisioner cleanup adapter, Upload cleanup, tree deletion, folder Copy rollback, file Copy rollback, direct removal (the adapter also serves New folder/ancestor cleanup). |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`, `verifyDestination`, `bindDestination`, `rollback`, `secureRetained`; late source retirement and survivor verification; `mergeContainer`, `verifyMerge` and metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; public `exclusive`, write/copy/move/remove wrappers. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`; conditional provisioning ACL and cleanup requests. |
| `lib/client/container-versions.ts`, `cleanup.ts` | `track`, `prepare`, `current`, `identity`, `committed`; only atomic receipts advance approved parent versions. `discardVersion`, `ownsEmptyContainer`; refusal probes never authorize replacing a captured validator. |
| `lib/client/protection-ledger.ts`, `source-operations.ts` | Protection/deletion get/set/clear, migration and retirement; `sourceOperation` and lock acquisition/release; all local hydration occurs before the final raw HTTP boundary. |
| `lib/operations/operations.ts` | `uploadFile` (fail/Replace/Keep both), `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`; `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `markRecovery`, `reconcilePending`, `requireTrashEntry`, `listTrash`; `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` folder merge, duplicate file/folder deletion, unsettled Copy and settled Move; `restoreItems`, `restoreItemsUnlocked`; `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Missing descendants never refresh a caller's approved root validator. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, marker/description writes, Type Index registration and resume; preconditions and final identity guards. |
| `state/ui.tsx`, `state/undo.ts` | `openDialog` capture/hydration; `refreshAfter`; Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash and explicit source-delete actions; Undo callbacks, `moveWithValidator`, tree identity transport; `errorMessage`, `reportFailure`, recovery URLs. |
| `state/uploads.ts`, `state/resource.ts` | Replace validator capture, `pump`, `resolve`, Retry and renewed confirmation; `withHydratedMetadata`, resource and preview version hydration. |
| `components/dialogs.tsx`, `protection-banner.tsx`, `views.tsx`, `file-browser.tsx`, `preview.tsx`, `upload-dock.tsx` | Dialog snapshots, displayed protection Delete identity, Delete forever/Empty Trash entry snapshots, bulk selection commands, preview reconciliation and loaded-file receipt, upload conflict decisions. |
| `lib/model/model.ts`, `lib/view/view.ts`, `lib/operations/operations.ts` | `DriveResource.modifiedAt`, `viewItems`, `formatModified`, `recentFiles`; the listing timestamp is shared by all consumers. |

The accepted Solid limitation remains concurrent changes between requests. Drive
uses captured conditional validators, refuses observed disagreements, preserves
recovery, and reports the change. It never adopts a foreign validator to repair
another client's content or ACL. No new asynchronous recheck was added between
the final identity HEAD and mutation.

Additional endpoint regressions cover caller-supplied header assertions on both
file/recursive removal and changed discovery on ACP/unreadable-ACL storage.
`drive-interactions-ui.test.ts` strengthens the existing Empty Trash descendant-race
case: after one child disappears, a changed approved root refuses the retry before
reading a second child; both remaining recovery files stay intact.
The read-only-policy fixtures in `drive-access.test.ts` and the authenticated
reload fixture in `drive-deletion-state.test.ts` now supply their known owner
WebID. `drive-review-round56-edges.test.ts` strengthens its missing-controller case
to require no destination writes and intact source bytes, rather than discovering
the missing recovery identity after copying.
The late-allocation regression in `drive-review-round64.test.ts` preserves the
source, the already-private destination and its concurrent owner-only ACL when a
backup identifier cannot be allocated. The repeated-stale-traversal case checks
both retry calls use the same confirmed root ETag and leave recovery intact.

## Reproduction

Final functional regressions were replayed against original `HEAD` source in the
isolated `/tmp/drive64-before` tree. **48 failed and five passed** across 53 selected
cases; the unchanged shared file/folder partial Restores, desktop toolbar variants,
and already-correct fixed-validator stale-traversal retry passed. A separate
pre-fix run reproduced all five added overwrite/root endpoint cases before their
implementation. Original source was restored only in `/tmp`; working-tree source
was never replaced during baseline testing.

## Final validation

From `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **274 files, 12,741 tests passed**, exit 0. All
  **481 configured source files** individually have **100% statements, branches,
  functions and lines**. Coverage globs and thresholds are unchanged.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

No network or localhost ports were used. Playwright was skipped as requested.
Changes remain uncommitted on `claude/DRV-04`.

## Complete changed paths

```text
src/apps/drive/components/drive.css
src/apps/drive/lib/client/README.md
src/apps/drive/lib/client/access.ts
src/apps/drive/lib/client/ancestors.ts
src/apps/drive/lib/client/client.ts
src/apps/drive/lib/model/root.ts
test/drive-access.test.ts
test/drive-deletion-state.test.ts
test/drive-interactions-ui.test.ts
test/drive-review-round54-boundaries.test.ts
test/drive-review-round56-edges.test.ts
test/drive-review-round64-audit.md
test/drive-review-round64-ui.test.ts
test/drive-review-round64.test.ts
test/drive/root.test.ts
```
