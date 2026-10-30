<!-- AUTHORED-BY Codex -->

# Drive review round 72

## Findings, classes and changed paths

| Finding / class | Fix and production paths | Regression tests |
| --- | --- | --- |
| Medium: discovery-dependent identification of arbitrary access-control resources. A sibling's absent custom ACL could be created as ordinary content, ending inheritance and revoking owner Read and Control. | `src/apps/drive/lib/client/client.ts`: shared `discoverContentTargets` runs before **all** public content mutation entries: write (Upload, Keep both, Replace, owner-only and metadata), createFolder, prepareTrash, mergeContainer, Copy, Move/Rename and remove (direct/recursive, recovery disposal, Delete forever, Empty Trash, purge and housekeeping). It discovers the entire readable containment namespace, including hidden names and other subtrees, using `fetchRdf` and typed `Container` accessors, and captures each child's WAC/ACP endpoint even if that endpoint is absent. Folder HEAD/GET discovery must agree. Errors, ambiguous discovery and pagination refuse before mutation. The root's explicit demo capability permits the existing no-ACL demo transport. No namespace proof survives into a later action. Namespace reads do not populate UI metadata caches. `src/apps/drive/lib/model/root.ts` reuses this helper before bootstrap and resume; `commitRoot` applies the same synchronous assertion to root PUT, root/description PATCH, and Type Index PUT. `src/apps/drive/lib/client/access.ts`: the existing synchronous content assertion now covers custom endpoints **and their ancestors**, including encoded aliases and trailing slash forms. Existing tree/placeholder/disposal/clearing assertions consume the hydrated set. | `test/drive-review-round72.test.ts`: `round 72: %s discovers absent custom sibling ACLs before any content mutation` (13 creation/transfer variants); `round 72: %s discovers an existing custom ACL without opening its protected resource` (Replace/owner-only Replace/Delete/Move); `namespace discovery blocks an encoded custom %s endpoint advertised from another subtree` (WAC/ACP); `incomplete namespace discovery (%s) stops all content mutation`; `a completed prior write cannot cache away a newly advertised custom ACL`; `namespace hydration cannot replace the confirmed %s validator`; `ancestor rejection after namespace hydration stops writes` (403 ancestor / missing storage root); `unavailable durable protection refuses %s before any repair or payload` (read/overwrite). `bootstrap cannot mint the Drive root at another resource's absent custom ACL` and `bootstrap resume discovers a newly advertised custom ACL before recreating its root` cover initialization and delayed resume. The owner-enforcing fixture in `test/drive-custom-acl-pod.ts` proves raw creation changes owner Read and Control from 200 to 403. |
| Medium: confirmation-host lifetime is shorter than operation preflight. A late request queues an unresolvable promise and retains source reservations forever. | `src/apps/drive/state/access-confirmation.tsx`: the shared hook owns a mounted flag. Layout cleanup closes the host before cancelling its queued requests. Any request arriving after closure resolves as Cancel without queueing state; setup reopens the host during StrictMode effect replay. All drag/drop, dialog, paste and reverse-move callers share the hook and unwind through the existing reservation `finally`. | `test/drive-review-round72-ui.test.ts`: `round 72: unmount %s cancels Move and releases source reservations for retry` (before queue / already queued). The real WAC client blocks a source GET, removes the dialog host, then resumes preflight. It verifies cancellation, no writes, intact source bytes, and a retry after remount in StrictMode that reaches a resolvable dialog instead of “already in progress”. |
| Requested shape (a): replacement of an approved identity with a later read. | Audited every call site below. Original `confirmationOptions`, `ResourceAssertion`, `commitHttp` and `checkIdentity` still pin the approved validators/discovery. Namespace hydration discards its ETags and cannot authorize an overwrite/delete. Only an atomic receipt from Drive's own committed mutation can advance a container identity. | Expanded `test/drive-review-round54-boundaries.test.ts`: `round 72 shape a: %s retains a replacement at its final identity check`, 73 scenarios. Three additional round-72 cases replace a selected item during the new namespace preflight and verify overwrite/remove/move preserve the replacement without sending any mutation. |
| Requested shape (b): non-HTTP hydration between the final identity check and irreversible HTTP. | All new discovery/deletion-ledger hydration precedes the existing shared boundary. No final conditional check or callback was added outside `commitHttp` / `checkIdentity`. Conditional HTTP is sent directly after those helpers' final assertions; committed steps disarm their compensation before ledger retirement. | `round 72 shape b: %s performs no local async work after the final HTTP identity check`, 73 scenarios, instruments IndexedDB and Web Locks at every mutation. |
| Keep round 67 closed: a matching ETag cannot excuse changed ACL/ACP endpoint or captured access-mode discovery. | Final target, policy, parent, source, survivor, rollback, quarantine and root/index checks all continue through the shared `checkIdentity`, directly or through `checkResourceIdentity` / `commitHttp`. Namespace discovery does not replace those captures or introduce a new final check. | `round 72 final discovery: $step refuses changed captured $change on its conditional HEAD`: 73 endpoint variants and 73 mode variants. Each target, policy, parent and survivor assertion at the chosen boundary is changed independently. |
| Requested partial Restore: compare against the archived original audience, rather than the private recovery audience. | Audited `recoveryPolicy`, public `bindAccess`, `preparePolicies`, `mergeContainer` and `restoreMissing`. Existing archive comparison remains correct; no production change was needed. | `round 72: partial Restore compares the archived shared original ($kind, Trash DELETE $status)`: file/folder with refused 403/412 DELETE. The original remains shared; recovery is owner-only; Restore succeeds, preserves the original policy and bytes, and retires the duplicate. Earlier person-specific own/inherited sharing regressions remain enabled. |

Namespace enumeration is conservative and costs reads proportional to storage size at each
public mutation entry, bootstrap or resume. Unreadable resources/containers or paginated containment prevent a
complete proof and therefore refuse the mutation. Root demo mode is an explicit fixture
capability, not a fallback for missing real-pod discovery. A concurrent change after
preflight remains subject to the existing conditional mutation and completion checks.

## Complete changed-path inventory

All paths are under `apps/suite/`; packages, fonts, dependencies, coverage configuration and
thresholds are unchanged.

- `src/apps/drive/lib/client/access.ts`
- `src/apps/drive/lib/client/client.ts`
- `src/apps/drive/lib/model/root.ts`
- `src/apps/drive/state/access-confirmation.tsx`
- `src/apps/drive/lib/client/README.md`
- `test/drive-custom-acl-pod.ts`
- `test/drive-review-round72.test.ts`
- `test/drive-review-round72-ui.test.ts`
- `test/drive-review-round54-boundaries.test.ts`
- `test/drive-review-round72-audit.md`
- `test/drive-review-round50.test.ts`: assert the earlier discovery refusal's nested HTTP cause and absence of mutations when the survivor listing fails.
- `test/drive-mergegate-round11.test.ts`: keep namespace HEAD discovery available while rejecting the archive body's GET, retaining coverage of the private fallback when archive bytes are unavailable.
- `test/drive-mergegate-round25.test.ts`: keep namespace HEAD discovery available while denying the archived-policy GET; assert the exact late refusal and no payload/DELETE requests.
- `test/drive-mergegate-round14.test.ts`: inject deletion after the operation's captured metadata HEAD, following namespace hydration; runtime policy validation still precedes any request.
- `test/drive-review-round54.test.ts`: widen defaults only after the Trash folder exists, preserving the original post-provisioning race rather than creating an orphan ACL before provisioning.
- `test/drive-review-round60.test.ts`: inject endpoint replacement after the operation captures absent-own-ACL discovery, following the new namespace HEAD.
- `test/drive-mergegate-round8-ui.test.ts`: measure filtering-only HEAD counts after startup hydration; filtering itself must still issue no child HEADs.
- `test/drive/root.test.ts`: the narrow no-ACL bootstrap fixture includes its storage root so namespace capability discovery is meaningful.
- `test/drive-client.test.ts`: narrow demo error transports explicitly advertise the storage-root demo capability before testing target HTTP error mapping.
- `test/drive-undo-ui.test.ts`: narrow demo transports explicitly advertise the same root capability; request-count assertions still require exactly one original conditional source read when refusing a replacement.

## Failing-before evidence

The corrected regression tests ran with all three production files temporarily restored to
HEAD, then automatically restored in a `finally` block: **14 failed, 1 passed, 18 deselected**.
All 13 custom-ACL creation/disposal cases and the late-confirmation case failed. The
already-queued cancellation control passed. The tree cases use an absent destination,
so their failure is not a coincidental existing-folder conflict. Before writing the fixes,
the initial owner-enforcing fixture also proved raw empty-policy creation revokes owner
Read and Control. Subsequent pagination, cross-subtree, freshness, and shared-Restore
cases extend the invariant rather than claiming new defects in unchanged Restore code. The later bootstrap regression was run before extending the shared guard to initialization: it failed by observing the forbidden PUT to `drive/`. It passes after the root reuses the same helper; delayed resume is covered too.

## Every irreversible-step scenario

Each scenario runs in both ordering tables and in both final-discovery variants. The
final-discovery test changes each supplemental assertion at its chosen boundary, including
policy, parent, source, survivor and target checks. Missing-discovery cases explicitly
require an early refusal instead of silently skipping the boundary.

- Trash index overwrite
- move
- rename
- Trash
- remove
- recursive remove
- Delete forever
- Empty Trash
- startup purge
- overwrite
- folder metadata
- Restore
- partial file Restore
- partial folder Restore
- copy payload
- ACL overwrite
- replacement rollback
- upload rollback
- new folder rollback
- copy rollback
- container rollback
- metadata undo
- policy archive cleanup
- receipt cleanup
- slot cleanup
- ancestor cleanup
- owner-only ACL
- owner-only overwrite
- owner-only folder overwrite
- private folder ACL
- protection receipt repair
- retained recovery clearing
- replay recovery clearing
- container merge
- partial folder Restore metadata
- copy rollback without Link
- container rollback without Link
- folder overwrite rollback with child defaults
- partial Restore rollback with child defaults
- inherited replacement rollback
- container provisioning ACL
- metadata undo recovery clearing
- post-retirement private backup ACL
- move tree
- rename tree
- Trash tree
- Restore tree
- Delete forever tree
- Empty Trash tree
- startup purge tree
- Replace completion recovery clearing
- Move completion recovery clearing
- Copy completion recovery clearing
- shared partial file Restore
- shared partial folder Restore
- verification and replay failure clearing
- Upload payload
- Keep both payload
- unconditional creation payload
- deny-all copy payload
- deny-all move
- deny-all rename
- deny-all Trash
- deny-all Restore
- root marker PATCH
- description marker PATCH
- Type Index overwrite
- safe-name Upload payload
- safe-name copy payload
- safe-name rename
- custom-name Upload payload
- custom-name copy payload
- custom-name rename

## Every audited call site


Re-ran the HEAD/GET, conditional-request, PUT/PATCH/DELETE and shared-helper grep
across `client.ts`, `access.ts`, `deletion.ts`, `commit.ts`, `operations.ts`, UI
state, provisioning and root initialization. The inventory below includes all
mutation/compensation, identity, confirmation and recovery callers inspected.
Read-only presence/error-reporting/ambiguous-delete settlement checks never
provide a fresh validator for a subsequent destructive request.

| Path | Audited call sites |
| --- | --- |
| `lib/client/commit.ts` | `confirmationOptions`, `discoveryOptions`, `requireResourceAssertion`, `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; target, policy, supplemental identity and protected-resource assertions; `Compensation.arm`, `disarm`, `rollback`, synchronous commit effects. |
| `lib/client/client.ts` | `discoverContentTargets` (storage HEAD, validated containment traversal, child discovery HEADs, directory HEAD/GET discovery agreement), `finalIdentity`, `checkResourceIdentity`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`; `listing`, `list`, `stat`, file/folder `snapshot`, `read`, `readVersion`, `readRdf`, `verifySnapshotIdentity`. |
| `lib/client/client.ts` | `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`; `guardedWrite` backup GET, placeholder, conditional payload, parent/target assertions, completion and both compensation branches; `write` owner-only protection and folder metadata; the four empty `rawPut` callers (`guardedWrite`, owner-only `write`, `provision.putFolder`, file `copySnapshot`). |
| `lib/client/client.ts` | `quarantine` private folder/backup creation, survivor assertions, conditional clearing and completion; `replayProtected`, `replayOrQuarantine`; `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, direct/recursive `remove`, survivor checks and private recovery after committed deletion. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`; ordinary Move `affected`, `bindDestination`, `verifyAccess`, destination capture, `verifyDestination`, renewed access consent, source deletion, completion and Undo receipts; `rollback`, `secureRetained`. |
| `lib/client/client.ts` | `mergeContainer`, `verifyMerge`, metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; `exclusive` and public write/createFolder/prepareTrash/mergeContainer/copy/move/remove wrappers. All ordinary mutation entries hydrate namespace discovery before any provisioning or disposal; internal placeholders, compensation, clearing and descendant destinations retain the synchronous content assertion. Partial Restore's access comparison uses the archived original grants. |
| `lib/client/access.ts` | `assertContentDestination`, `discover`, `captureEndpoint`, `verifyEndpoint`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured-source checks, `acceptCreation`, `identities`, `verifyEndpoint`, `installed`, `recheck`, `retire`, `rollback`, destination policy; `projectAccess`, `materializeAccess`, `retargetAccess`, `accessGains`, `intersectAccess`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`; ledger/lock/serialization work precedes final mutation checks. The outer creation compensation delegates to the same empty conditional PUT boundary. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; durable intent, conditional DELETE, definitive refusal, ambiguous settlement, synchronous compensation disarm and parent receipts before later ledger retirement. |
| `lib/client/container-versions.ts`, `cleanup.ts`, `protection-ledger.ts`, `source-operations.ts` | `track`, `prepare`, `identity`, `current`, `committed`; only atomic own-mutation receipts advance parents; `discardVersion`, `ownsEmptyContainer`; protection/deletion ledger hydration, migration, persistence and retirement; source reservations and Web Locks. A later read never rebases a refused cleanup. |
| `lib/operations/operations.ts` | `uploadFile` fail/Replace/Keep both, `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`. |
| `lib/operations/operations.ts` | `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`; `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` metadata merge, duplicate file/folder disposal, unsettled Copy and settled Move; `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Purge retains the identities from its initial list; final mutations are not authorized by the later existence read. |
| `lib/model/root.ts` | `discoverContentTargets`, `ensureDriveRoot`, `createRoot`, `commitRoot`, `readRoot`, `validateRoot`, `initialize`, `register`, `resume`; empty conditional root creation, conditional root/description marker PATCH, Type Index PUT; original index ETag and discovery remain pinned; `commitRoot` rejects ordinary mutations of known auxiliary targets, and `resume` refreshes namespace discovery rather than reusing a prior action's namespace proof. |
| `state/ui.tsx`, `state/undo.ts`, `state/uploads.ts` | Dialog/toast captures; `refreshAfter`, Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash/source deletion; `confirmedAbsent` is read-only preference cleanup; `moveWithValidator`, reverse tree guards, rollback receipts; upload `pump`, `confirm`, `resolve`, Retry, Replace renewal, final invalidation; `reportFailure`, `errorMessage`, pending-deletion Retry. |
| `state/resource.ts`, `state/access.ts`, `state/access-confirmation.tsx`, `components/dialogs.tsx`, `components/views.tsx`, `components/protection-banner.tsx` | `withHydratedMetadata`, `useLiveResource`, `useLiveItems`, `useResourceVersion`, access-label hydration, queued consent, layout cleanup, closed-host cancellation and StrictMode setup; Rename/Move/source deletion confirmation captures; `TrashView.load`, subtree subscription, Restore action and Delete forever/Empty Trash entry snapshots; protection Delete's original ETag/discovery. |
| `state/drag-items.ts`, `components/file-browser.tsx`, `components/breadcrumbs.tsx` | `captureDragItems`, `takeDragItems`, `clearDragItems`; list/grid drag start/end and folder/breadcrumb drops; command target resolution, selection/listing reconciliation, route-unmount Details cleanup, menu dispatch. A drop consumes the initiating client's immutable capture. |
| `components/details.tsx`, `components/preview.tsx`, `components/item-menu.tsx`, `components/upload-dock.tsx` | Details/live resource commands, preview reads and action dispatch, item/Trash menus, upload conflict decisions and error rendering. None introduces a direct destructive HTTP request or substitutes post-confirmation metadata. |
| `components/drive-app.tsx`, `state/drive-context.tsx`, `state/purge-marker.ts` | Startup purge, session marker, result/failure reporting and settlement invalidation; usage subtree subscription; `DriveProvider.invalidate`, session push subscription and pending-deletion startup reconciliation; `useFolder` generation-scoped reload. This is the only purge invocation in production. Explicit actions already reconcile in `refreshAfter`/`finally`; queued uploads reconcile in `pump.finally`; provisioning emits its settlement callback. |


Solid provides no transactions. Conditional mutations preserve replacements, detected
content/access disagreement stops further disposal, and recovery remains available.
Compensation never rebases onto another client's ACL or content. The agreed gap between
two requests remains a documented residual; this pass adds namespace preflight for the
reported Drive-caused policy creation, not extra final rechecks to hide that gap.

## Validation

All required checks ran from `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **290 files, 13,225 tests passed**, exit 0.
  Independent inspection of `coverage/coverage-summary.json` confirms all **481
  configured source files** have **100% statements, branches, functions and lines**.
  No coverage glob or threshold changed.
- `npx tsc --noEmit -p .`: passed, exit 0, on the final source/tests.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

The final round-72 client file passes all **42** cases; both UI lifetime cases
pass; the shared boundary matrix passes all **294** cases on the final code.
The 102 bootstrap tests also pass with the shared namespace guard. The final full
run includes every case above, including late ancestor/archive/durable-protection
refusals. Earlier full runs exposed shadowed error branches as discovery began
refusing earlier; tests now explicitly reach those later refusals without
changing production behavior or coverage thresholds.

All **20 changed paths** are listed above and remain inside `apps/suite`.
No package, dependency, font, coverage-config or threshold changes, external
network calls, localhost listeners, commits or publishing were made. Playwright
was skipped as requested. No font/build workaround was needed.
