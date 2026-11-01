<!-- AUTHORED-BY Codex -->
# Drive review round 69

Paths are relative to `apps/suite`. The patch stays in this app on `claude/DRV-04`.
No commit, dependency, package/font edit, external network call or localhost
listener was added. Playwright is excluded as requested.

## Findings, classes, and every changed path

| Finding / class | Fix and changed paths | Regression tests |
| --- | --- | --- |
| Medium: confusing an empty grant projection with an absent ACL | `src/apps/drive/lib/client/access.ts`: `effective` stops at the nearest existing ACL even with zero applicable defaults; `bindAccess.installed` replaces the old default capture even with an empty projection; `materializeAccess` represents that known deny-all projection through a typed authorization with no principals or modes, so copying it cannot reactivate destination inheritance. `src/apps/drive/lib/client/client.ts`: ordinary Move treats every own ACL as an inheritance barrier, removing the grant-count-based `hasDefaults` predicate. `test/drive-wac-pod.ts`: anonymous enforcement stops at the first existing ACL; `aclBody` can explicitly omit defaults. `test/drive-access.test.ts`: correct the older assertion that expected public fallback and the two ordinary-folder Move prompt expectations. With an own ACL preserved, descendants do not acquire ancestor grants and no widening consent is needed. | `test/drive-review-round69.test.ts`: `Make a copy cannot turn a denied descendant into a public own ACL` (the reported operation, including anonymous denial before/after); `nearest ACL with %s governs an empty inherited projection` (absent and unrelated defaults); `the WAC fixture stops at the nearest existing ACL even without defaults`; `%s preserves a nearest ACL's empty default projection without publishing secrets` (Copy, Move, Rename, folder Copy, folder Move, auditing exposure after every request); `installing a folder ACL with no defaults replaces the previous inherited default capture`; `an own folder ACL blocks inherited Move widening even without default grants`. |
| Low: a global Details toggle bypasses the focused item's command targets | `src/apps/drive/components/file-browser.tsx`: `]`, `d`, and Alt+Enter share the same focused-or-selected target resolution and toggle; the listing consumes the event once. `src/apps/drive/components/drive-app.tsx`: the global fallback honors already-handled events and remains available outside the listing. | `test/drive-review-round69-ui.test.ts`: `] targets the unselected focused %s item and toggles once` (list and grid); `] uses the same focused-or-selected targets as d`. Tests mount DriveApp, FileBrowser and the real Details pane against the WAC pod. |
| Requested invariant: shared partial Restore compares the archived original audience | Audited `client.bindAccess`, `recoveryPolicy`, `preparePolicies`, `mergeContainer`, and `operations.restoreMissing`. Their existing archive comparison remains correct. No fresh policy/validator replaces confirmation; the private recovery policy does not become the original's comparison baseline. | `test/drive-review-round69.test.ts`: `shared %s partial Restore compares archived original access after refused Trash DELETE` (file and folder). The shared original remains shared, recovery is owner-only, Restore completes and retires recovery while preserving the original ACL. |
| Captured discovery replaced during bootstrap preflight | `src/apps/drive/lib/model/root.ts`: registration now carries the first Type Index GET's discovery alongside its original ETag, through the existing `commitRoot` / `commitHttp` synchronous final assertion. Later binding reads cannot adopt another endpoint or access-mode baseline. No new request is added. | `test/drive-review-round54-boundaries.test.ts`: `bootstrap registration retains its first index discovery (%s)` (endpoint and modes). Both regressions returned success and wrote the index before the fix. |
| Requested classes: captured identity replacement; local async work after a final identity check; final content checks missing discovery | Audited all callers below. Existing `commitHttp` already takes hydrated inputs, retains If-Match verbatim, runs local hydration/rechecks before helper-owned HTTP assertions, and sends the mutation without another local await. `checkIdentity` checks both the content validator and the synchronous captured ACL/access-mode assertion. No additional recheck/helper was needed. Committed compensation is disarmed before later ledger retirement. | `test/drive-review-round54-boundaries.test.ts`: three tables, 65 variants each, named `round 69 shape a`, `round 69 shape b`, and `round 69 final discovery`. Added deny-all Copy payload, Move, Rename, Trash, Restore; root marker PATCH, description marker PATCH and Type Index overwrite. The endpoint table changes each policy, parent, source, survivor and target assertion in the intended boundary. Its trace preserves earlier known-policy checks across conditional absence HEADs; those checks cannot erase preceding guards from the matrix. |

The UI audit additionally found **captured drag identities replaced at drop**.
`src/apps/drive/state/drag-items.ts` now holds immutable item/validator/discovery
captures under a single-use opaque token scoped to the initiating Drive client.
`src/apps/drive/components/file-browser.tsx` captures once for both list and grid,
consumes that capture for folder drops, and retires it on drag end.
`src/apps/drive/components/breadcrumbs.tsx` consumes the same capture instead of
performing fresh drop-time HEADs. Neither path resolves the drag from a later
listing. `test/drive-review-round69-ui.test.ts` adds the four-case table
`round 69 shape a: $target drop in $mode retains the drag's confirmed identity
after a listing refresh`, two successful unchanged-drag cases, and token
immutability, client scoping, cancellation, supersession and replay checks.
All four race cases failed before this fix: Drive passed the replacement's
validator and moved the other client's bytes. They now retain the original
validator and discovery, report the conflict, and leave the replacement intact.

Documentation changes: `src/apps/drive/lib/client/README.md` and this audit.
The full changed-path inventory is the seven source files above, that README,
`test/drive-access.test.ts`, `test/drive-wac-pod.ts`,
`test/drive-mergegate-round4.test.ts`,
`test/drive-review-round54-boundaries.test.ts`, `test/drive-review-round69.test.ts`,
`test/drive-review-round69-ui.test.ts`, and `test/drive-review-round69-audit.md`.

## Failing-before evidence

Before editing production source, the initial functional tests produced nine
failures (including the incorrect fixture), and all three UI cases failed.
A second replay in `/tmp/drive69-before` used original HEAD source with the
corrected WAC fixture: **11 failed, four passed**. This independently reproduces
real anonymous exposure on file/folder transfers and the focused-target bug;
it does not depend on the original fixture's incorrect ancestor fallback.
The shared-original Restore tests and the fixture contract pass in that replay.
The workspace source was never replaced during replay. A further original-HEAD replay of the exact Make a copy operation failed too: the denied source became an anonymously readable copy. Both bootstrap preflight discovery cases failed in the workspace before their fix.

The final isolated replay with Make a copy included produced **12 failed, four
passed** across the 16 functional/UI cases. Replaying the final two bootstrap
discovery regressions against that original source also produced **two failures**.
The fixed workspace passes all **213 focused cases**, including the three
65-variant mutation tables and both bootstrap discovery regressions.

The ordinary-folder Move regression also failed in an isolated intermediate
replay with the fixed resolver but the old grant-count inheritance predicate:
it incorrectly asked to widen access, then cancelled. With ACL existence as the
barrier, it completes without consent and keeps descendants denied anonymously.
The first resolver fix alone refused empty policy materialization; the typed
no-grant authorization allows those transfers to complete without exposure.

The first full run passed 13,013 tests and found one earlier contradictory
expectation in `test/drive-mergegate-round4.test.ts`: it called a readable ACL
with no matching defaults unresolved. That contract now has a separate known
deny-all case, retaining the genuinely unresolved-chain tests. Its 18 tests pass.

## All irreversible-step variants

The three tables exercise the same 65 variants:

- Trash index overwrite; Move; Rename; Trash; direct and recursive remove;
  Delete forever; Empty Trash; overwrite; folder metadata; Restore; partial file
  and folder Restore; Copy payload; ACL overwrite.
- Replacement, Upload, New folder, Copy and container rollback; metadata undo;
  policy archive, recovery receipt, slot and ancestor cleanup; owner-only ACL,
  file and folder overwrite; private folder ACL; protection receipt repair.
- Retained/replayed recovery clearing; container merge; partial folder Restore
  metadata; Copy/container rollback without Link; folder/partial Restore rollback
  with independent child defaults; inherited replacement rollback; container
  provisioning ACL; metadata undo recovery clearing; private backup ACL.
- Move, Rename, Trash, Restore, Delete forever and Empty Trash trees;
  Replace/Move/Copy completion recovery clearing; shared partial file and folder
  Restore; failed verification/replay clearing; Upload, Keep both and unconditional
  creation payloads.
- Deny-all Copy payload, Move, Rename, Trash and Restore; root marker PATCH,
  description marker PATCH and Type Index overwrite.

Missing discovery refuses cleanup before a boundary rather than authorizing a
new endpoint. The tables distinguish payload, rollback, clearing, and cleanup
requests so a different guarded step cannot satisfy the refused-step assertion.
The bootstrap uses conditional PATCH as well as PUT; these PATCH callers are now
explicitly covered in all three tables.

## Every audited call site

All source paths in this table are under `src/apps/drive/`. The grep inventory
covered HEAD, GET and conditional mutations in client/access/deletion/commit,
operations, UI state, plus provisioning, rollback and root initialization. Reads
used only for planning, ambiguous-delete settlement or error reporting do not
authorize mutation; final assertions remain in the shared boundary.

| Path | Call sites audited |
| --- | --- |
| `lib/client/commit.ts` | `confirmationOptions`, `discoveryOptions`, `requireResourceAssertion`, `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; target, policy, supplemental resource and protected-resource assertions; `Compensation.arm`, `disarm`, `rollback`, synchronous commit effects. |
| `lib/client/client.ts` | `finalIdentity`, `checkResourceIdentity`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`; `listing`, `stat`, file/folder `snapshot`, `readVersion`, `readRdf`, `verifySnapshotIdentity`. |
| `lib/client/client.ts` | `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`; `guardedWrite` backup GET, placeholder, payload, parent/target assertions, completion and both compensation branches; `write` owner-only protection and folder metadata; all four empty `rawPut` callers (`guardedWrite`, owner-only `write`, `provision.putFolder`, file `copySnapshot`). |
| `lib/client/client.ts` | `quarantine` folder/backup creation, survivor assertions, conditional clearing, completion; `replayProtected`, `replayOrQuarantine`; `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, direct/recursive `remove`, survivor checks and private retention after committed recovery deletion. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`; Move `affected`, destination capture, `verifyDestination`, `bindDestination`, `verifyAccess`, renewed consent, source deletion and completion; `rollback`, `secureRetained`; Undo receipts. |
| `lib/client/client.ts` | `mergeContainer`, `verifyMerge`, metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; `exclusive`, public write/copy/move/remove wrappers. |
| `lib/client/access.ts` | `discover`, `captureEndpoint`, `verifyEndpoint`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured source validation, creation receipt acceptance, `identities`, `verifyEndpoint`, `installed`, `recheck`, `retire`, `rollback`, destination policy; `projectAccess`, `materializeAccess`, `retargetAccess`, `accessGains`, `intersectAccess`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`; ledger/lock/serialization work precedes final HTTP checks. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; intent persistence, conditional DELETE, definitive refusal, ambiguous settlement and compensation retirement before later persistence. |
| `lib/client/container-versions.ts`, `cleanup.ts`, `protection-ledger.ts`, `source-operations.ts` | `track`, `prepare`, `identity`, `current`, `committed`; only atomic mutation receipts advance captured parent validators; `discardVersion`, `ownsEmptyContainer`; protection/deletion ledger hydration, migration and retirement; source reservations and Web Locks. |
| `lib/operations/operations.ts` | `uploadFile` fail/Replace/Keep both, `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`. |
| `lib/operations/operations.ts` | `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`; `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` folder merge, duplicate file/folder removal, unsettled Copy, settled Move; `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, `initialize`, `readRoot`, `validateRoot`, `register`, `resume`; conditional root/description marker PATCH and Type Index PUT; original index ETag and discovery remain pinned through registration, including when the binding reads a different endpoint/mode after the initial GET. |
| `state/ui.tsx`, `state/undo.ts`, `state/uploads.ts` | Dialog/toast capture, `refreshAfter`, Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash/source deletion; reverse Move `moveWithValidator`, tree guards and receipts; upload `pump`, `confirm`, `resolve`, Retry and Replace renewal. Confirmed resource identities survive operations; observed disagreements surface through `errorMessage`/`reportFailure`/queue errors. |
| `state/resource.ts`, `state/access.ts`, `components/dialogs.tsx`, `components/views.tsx`, `components/protection-banner.tsx` | Metadata/access and confirmation hydration, `withHydratedMetadata`, `useLiveResource`, `useResourceVersion`; captured Rename/Move/source deletion items; Delete forever/Empty Trash entry snapshots; protection Delete's original ETag/discovery. |
| `state/drag-items.ts`, `components/breadcrumbs.tsx`, `components/file-browser.tsx` | `captureDragItems`, `takeDragItems`, `clearDragItems`; list/grid `onDragStart`, `onDragEnd`, folder `onDrop` and breadcrumb `onDrop`. All targets consume the initiating client's immutable capture; canceled, foreign, superseded and consumed tokens cannot authorize another move. |
| `components/file-browser.tsx`, `components/drive-app.tsx`, `components/item-menu.tsx`, `components/preview.tsx`, `components/details.tsx`, `components/upload-dock.tsx` | Focused/selected targets, Details openers, selection/listing reconciliation, previews, access labels, upload decisions and errors. `]` now shares the listing's `d`/Alt+Enter path and is consumed once. |

Concurrent changes between two requests remain the agreed Solid transaction
limitation. Drive refuses observed content/discovery/policy disagreements,
preserves recovery and foreign changes, and reports the failure. Compensation
never adopts a replacement validator or reverts a concurrent ACL/content edit.

## Validation

Final checks ran from `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **284 files, 13,021 tests passed**; every configured
  coverage file has **100% statements, branches, functions and lines**.
- `npx tsc --noEmit -p .`: passed.
- `npx biome check src test`: passed, with the same 72 existing warnings.
- `git diff --check`: passed.

The final full run includes all 10 round 69 UI cases and the new shared drag
capture. The focused UI/interaction check also passed all 108 cases. All work is
uncommitted, with changes confined to this app. No package or font files changed.
Playwright was skipped as requested; no listener or network access was used.
