<!-- AUTHORED-BY Codex -->

# Drive review round 60

## Findings, shared classes, and changed paths

Paths are relative to `apps/suite/`.

| Finding | Class and shared fix | Changed paths | Regression names |
| --- | --- | --- | --- |
| Failed Replace breaks inheritance | Captured absence was converted into an installed own policy during compensation. `replayProtected` preserves the complete captured policy or absence, pins both that endpoint and its governing policy, and verifies them before and after replay; it never installs an ACL. `replayOrQuarantine` shares private evacuation between file overwrite and folder metadata undo when replay encounters changed access. Metadata undo retains its complete original policy even for empty metadata and checks content ownership before replay. Evacuation checks independent recovery identities, saves both versions privately, and conditionally clears only Drive's PUT; it never rewrites another client's ACL/content. | `src/apps/drive/lib/client/client.ts`: `guardedWrite` compensation, `replayProtected`, `replayOrQuarantine`, `mergeContainer` metadata compensation. | `drive-review-round60.test.ts`: `failed Replace/standalone overwrite preserves captured own ACL absence and future inheritance`; `failed folder overwrite/metadata undo preserves inherited sharing for nonempty folder metadata`. |
| Move misses final access recheck | Successful mutations could return after local retirement without checking surviving access. The shared `transfer` success path checks access after source DELETE and its IndexedDB retirement, inside the existing partial-transfer recovery handler. This covers Move, Rename, preserve-source transfers, Trash, Restore, and reverse moves. Source commit already disarms compensation synchronously; recovery cannot delete the surviving file after source commit. | `src/apps/drive/lib/client/client.ts`: `transfer`. | `drive-review-round60.test.ts`: `Move/Rename/preserve-source rechecks surviving access after committed source DELETE retirement`. Tests retain confidential recovery and preserve the concurrent policy. |
| Repair/provisioning replace absent ACL endpoint | Shape (a): endpoint identity was omitted while absence had no ETag to compare. `bindAccess.recheck` compares endpoint URLs as well as validators. Repair and provisioning pass the captured endpoint and absence to installation. Owner-only overwrite and existing Trash protection capture the original own ACL from the original resource HEAD, failing closed on unknown access. `protect` requires a pre-hydrated endpoint and policy receipt, including absence; it refuses missing inputs before I/O and cannot discover a replacement endpoint. Every guarded ACL write also checks discovery synchronously in its existing final resource HEAD. The HTTP boundary accepts only synchronous header assertions; no additional request or asynchronous hydration is inserted. | `src/apps/drive/lib/client/access.ts`: `store`, `bindAccess.recheck`; `src/apps/drive/lib/client/ancestors.ts`: `verify`, `create`, `protect`; `src/apps/drive/lib/client/client.ts`: `captureOwnAccess`, owner-only `write`, `prepareTrash`; `src/apps/drive/lib/client/commit.ts`: `HttpIdentity`, `commitIrreversible`, `commitHttp`, `checkIdentity`. | `drive-review-round60.test.ts`: `binding pins absent source/destination ACL endpoints even when both policies have no validator`; `protection repair/container provisioning/owner-only overwrite/Trash protection refuses replacement of a captured absent ACL endpoint`; `install/private folder/protection repair/provisioning pins the ACL endpoint through its final resource identity HEAD`; `protection requires a pre-hydrated ACL endpoint/policy before any I/O`. |
| Upload errors are silent | Failure announcements omitted terminal errors. The dock's persistent live heading counts failures, and each transition into failure sends one error toast containing the file name and error, including with a collapsed dock. Retrying clears the announcement receipt so a later failure can be announced again. | `src/apps/drive/components/upload-dock.tsx`. | `drive-review-round60-ui.test.ts`: `failed uploads announce the permission error and status, including when collapsed (false/true)`, exercising an actual 403 upload and Retry. |
| Shared-original partial Restore guidance | The existing archived-policy comparison remains intact: the original is compared with the policy saved at Trash time, while the private recovery copy keeps its live owner-only baseline. | No production change needed. | `drive-review-round60.test.ts`: `partial Restore compares a shared original against the archived policy after Trash DELETE 403`. |

Additional changed tests:

- `test/drive-review-round60.test.ts` additionally checks explicit demo replay without a fabricated ACL validator, refusal of foreign folder RDF even if a server reuses an ETag, and Restore/Delete forever preserving a replaced archive after refused conditional cleanup. The last cases exercise the read-only cleanup probe without authorizing a refreshed DELETE.

- `test/drive-review-round54-boundaries.test.ts`: 39-step, two-shape matrix; adds inherited replacement replay, container provisioning ACL, and metadata-undo recovery clearing. The metadata-undo scenario uses a transient read failure with unchanged ACLs to exercise actual replay. Concurrent ACL changes now exercise evacuation separately.
- `test/drive-mergegate-round13.test.ts`: the payload source audit follows `replayOrQuarantine` through `replayProtected` to `guardedWrite`, checking unchanged arguments at both hops; two negative cases reject incorrect forwarding and an unguarded inner request.
- `test/drive-review-round50.test.ts`: changed inherited grants require private preservation of both versions, just like a concurrent own ACL. The former assertion required freezing the old inherited audience at the original URL.
- `test/drive-review-round53.test.ts`: a transient policy-read failure triggers metadata undo, whose captured PUT is then refused. The asserted 412 remains available through the partial-failure cause.
- `test/drive-review-round55.test.ts`: a foreign replacement remains readable under its own verified private ACL; the old upload's failed protection requirement must not attach to it.
- `test/drive-review-round56.test.ts`: hidden/replaced discovery preserves ACL absence and privately evacuates Drive's bytes; the replay-race fixture installs a concurrent policy after the first PUT rather than depending on the removed inheritance-freezing write.
- `test/drive-review-round58.test.ts`: unknown initial discovery is refused earlier, with the original `ACL Link unavailable` cause.
- `test/drive-gate-regressions.test.ts`: unknown access during metadata undo preserves both versions privately before conditionally clearing Drive's merged RDF; the unreadable foreign ACL remains unchanged.

## Every audited call site

Paths below are relative to `apps/suite/src/apps/drive/`. This includes every raw destructive HTTP seam and the operations/UI callers that carry confirmation validators into it. Existing correct paths were audited without changing them.

| Path | Call sites |
| --- | --- |
| `lib/client/commit.ts` | `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; `Compensation.arm`, `disarm`, `rollback`. All request data and persistence precede the raw HTTP identity checks; the new header assertion is synchronous. |
| `lib/client/access.ts` | `discover`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; `store`, `install`, `privateFolder`; `bindAccess.resolve`, `identities`, `destinationOwn`, `destinationPolicy`, `installed`, `recheck`, `retire`, `rollback`; `intersectAccess`, `projectAccess`, `materializeAccess`, `retargetAccess`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. |
| `lib/client/client.ts` | `captureResource`, `checkContainerVersion`, `requireOwnReceipt`, `captureOwnAccess`, `createdOwnAccess`, `stat`, `readVersion`, `readRdf`, `snapshot`, `verifySnapshotIdentity`; destination capture and `verifyDestination`. |
| `lib/client/client.ts` | `guardedWrite` and both compensation branches, `write`, `rawPut`, `replayProtected`, `replayOrQuarantine`, `quarantine`, `createFolder`, `prepareTrash`. |
| `lib/client/client.ts` | `deleteVersion`, `deleteSnapshot`, `remove`; `copySnapshot`, `transfer`, `copy`, `move`, `rollback`, `secureRetained`. |
| `lib/client/client.ts` | `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, `mergeContainer`, metadata compensation, `verifyMerge`, `bindDestination`, public `bindAccess`, `exclusive`, public write/copy/move/remove wrappers; scope rechecks, retirement, and compensation selection. |
| `lib/client/container-versions.ts` | `track`, `prepare`, `current`, `identity`, `committed`. Captured validators advance only with atomic receipts from Drive's mutations. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`; `classifyDelete`. Intent persistence precedes final HTTP checks; committed DELETE disarms compensation before retirement. |
| `lib/client/cleanup.ts` | `discardVersion`, `ownsEmptyContainer`. Refused cleanup never adopts a fresh read's ETag. |
| `lib/operations/operations.ts` | `uploadFile`, `renameItem`, `moveItems`, `copyItem`, `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `markRecovery`, `reconcilePending`, `listTrash`, `trashItems`, `trashItemsUnlocked`, `runTrash`, `requireTrashEntry`, `removeCompletedRecords`. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`, `restoreMissing`, `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Partial Restore retains captured survivor identities and archived original policies. |
| `state/ui.tsx` | `openDialog`, `refreshAfter`, rename/move/copy/Trash/Restore/Delete forever/Empty Trash/source-delete actions, Undo callback, `reportFailure`, `errorMessage`, `recoveryLocations`. |
| `state/undo.ts`, `state/uploads.ts` | `moveWithValidator`, tree verification and conditional fetch wrapper; upload conflict capture, `pump`, `resolve`, retry, and `describe`. |
| `state/resource.ts`, components | `useLiveResource`, `withHydratedMetadata`; `file-browser.tsx` selection, commands, preview reconciliation; `dialogs.tsx` rename/move/source-delete/Trash-delete snapshots; `views.tsx` Delete forever/Empty Trash snapshots; `preview.tsx` loaded-file validator; `upload-dock.tsx` progress and error announcements. |

The two-shape matrix covers all 39 scenarios: Trash index overwrite; Move, Rename, Trash, remove, recursive remove; Delete forever, Empty Trash; overwrite, folder metadata; Restore, partial file/folder Restore; Copy payload; ACL overwrite; replacement, Copy, container rollback; metadata undo; archive, receipt, slot, ancestor cleanup; owner-only ACL/file/folder overwrite; private-folder ACL; protection repair; retained/replay recovery clearing; container merge; metadata-bearing partial folder Restore; file/container rollback without Link; folder-overwrite/partial-Restore rollback with child defaults; inherited replacement rollback; container-provisioning ACL; metadata-undo recovery clearing. Each has a validator-replacement test and an IndexedDB/Web Lock ordering test. The round 57 matrix additionally tests selected validators replaced before preflight.

No attempt is made to make Solid's separate requests transactional. Unexpected content/access changes stop the next ordinary irreversible step and are surfaced; conditional recovery protects Drive's own bytes without reverting another client's ACL/content. The final Move recheck closes Drive's missing post-retirement check, and the ACL endpoint assertion extends an existing identity HEAD rather than adding a request for the accepted interval between requests.

## Complete changed-file list

All paths are relative to `apps/suite/`:

```text
src/apps/drive/components/upload-dock.tsx
src/apps/drive/lib/client/README.md
src/apps/drive/lib/client/access.ts
src/apps/drive/lib/client/ancestors.ts
src/apps/drive/lib/client/client.ts
src/apps/drive/lib/client/commit.ts
test/drive-gate-regressions.test.ts
test/drive-mergegate-round13.test.ts
test/drive-review-round50.test.ts
test/drive-review-round53.test.ts
test/drive-review-round54-boundaries.test.ts
test/drive-review-round55.test.ts
test/drive-review-round56.test.ts
test/drive-review-round58.test.ts
test/drive-review-round60-audit.md
test/drive-review-round60-ui.test.ts
test/drive-review-round60.test.ts
```

## Reproduction and validation

The initial new client/UI regressions failed before their fixes: 11 failures. Four further final-HEAD endpoint variants also failed before extending the HTTP boundary. The initial complete round 60 client/UI files were run against the original source in `/tmp/drive60-before`: **19 failed and one passed**. After adding receipt, demo, foreign-RDF, and archive-cleanup cases, the final **26 tests** were checked against that original source again: **22 failed and four passed**. The already-correct cases are archived-policy partial Restore, refusal of foreign RDF with a reused ETag, and both archive-cleanup variants. The working tree was never replaced for these baseline runs.

Validation ran from `apps/suite` with `PATH=/opt/node24/bin:$PATH`, without network access:

- `npx vitest run --coverage` (with additional JSON and report-on-failure reporters): **267 files, 12,539 tests passed**, exit 0. All **481 configured source files individually have 100% statements, branches, functions, and lines**. Coverage globs and thresholds are unchanged.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0, with 72 existing warnings and no errors.
- `git diff --check`: passed.

The coverage run exposed obsolete replay/protection fallbacks after all callers began supplying complete receipts. These were removed to enforce the pre-hydrated-input invariant; the cleanup read-only probe gained explicit late-conflict tests. The final complete run above includes those changes and all 78 matrix tests. Earlier intermediate failures are not treated as validation passes.

No dependencies, shared packages, fonts, or commits were changed. All changes remain in the working tree. Playwright is skipped because localhost ports cannot be bound.
