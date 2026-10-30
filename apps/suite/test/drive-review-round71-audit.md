<!-- AUTHORED-BY Codex -->
# Drive review round 71

Changes remain uncommitted on `claude/DRV-04`. All paths below are relative to
`apps/suite`. No package, dependency, font, network or localhost change was made.

## Findings, classes and every changed path

| Finding / class | Fix and production paths | Regression tests |
| --- | --- | --- |
| High: an ordinary file placeholder can become the folder's own ACL, terminating inheritance and revoking owner access. | `src/apps/drive/lib/client/access.ts` owns the synchronous `assertContentDestination` invariant. It rejects decoded `.acl`/`.acr` path segments (case insensitive), including implicit ancestors, and actual custom WAC/ACP endpoints learned through discovery, including encoded aliases. `src/apps/drive/lib/client/client.ts` invokes it before standalone `write`, before and after `guardedWrite` hydration, at `transfer` entry and for every captured descendant before any tree write/archive, and before `mergeContainer`, `remove` and every `deleteVersion`; quarantine clearing uses the same assertion. Move/Rename validates both source and destination, including every descendant, before disposal. `src/apps/drive/lib/client/ancestors.ts` applies the same invariant before ancestor provisioning and after creation's binding discovery. Together these cover Upload, Keep both, Replace, unconditional/owner-only writes, Copy, Move/Rename, Restore, metadata merge, private backups and all four empty `rawPut` callers. Conditional ACL installation retains its separate policy seam. | `test/drive-review-round71.test.ts`: `round 71: $step refuses auxiliary $name before any placeholder can revoke owner access`, including Upload and Rename of a Turtle `notes.ttl` to `.acl`. The owner-enforcing in-memory WAC fixture proves empty ACLs deny owner Read and Control; the regressions require no mutation at all, preserved inheritance, readable owner ACL endpoints and surviving bytes. |
| Medium: the same placeholder class can install `secret.acl`, denying access and Control over an existing inherited sibling. | Same shared helper and all the same paths above; no separate sibling-only exception. Existing policies are rejected before ordinary replacement or deletion too, so removing an ACL cannot resume broader inheritance. Full-tree preflight prevents a later reserved child from leaving a partly created destination. | The same `$step` table's `secret.acl` cases; `round 71: ordinary %s disposal cannot remove an access-control resource and resume inheritance`; `round 71: %s cannot replace a captured existing auxiliary policy`; encoded/case/ancestor destination table; reserved folder and descendant tables; custom WAC/ACP endpoint table. Safe `.acl.txt`, `.acls` and space-containing names remain writable. |
| Medium: Details targets outlive the listing route that supplied their selection. | `src/apps/drive/components/file-browser.tsx`: a layout-effect cleanup releases shared Details targets when the route body unmounts. Existing folder-change and user-selection handling remains shared by every FileBrowser. Targets clear before the next route's layout effects, including routes with no FileBrowser; the pane's open preference remains available. | `test/drive-review-round71-ui.test.ts`: `round 71: route remount to %s clears Details metadata and access without a selection`. Real DriveApp against the WAC pod; select, open Details, verify sharing, then commit a route remount. Covers the My Drive sidebar link, Recent, Starred, Trash (no FileBrowser), and a same-folder remount. |
| Requested shape (a): a later read replaces the approved validator/discovery. | Whole-client, operations and UI audit below. The existing `confirmationOptions`, `ResourceAssertion`, `commitHttp` and `checkIdentity` already retain approved captures; own successful conditional mutation receipts are the only permitted transitions. No production boundary replacement was needed. | `test/drive-review-round54-boundaries.test.ts`: `round 71 shape a: %s retains a replacement at its final identity check`, 70 scenarios. Added safe ACL-like names through Upload, Copy and Rename so the new destination guard also traverses real mutation boundaries. |
| Requested shape (b): IndexedDB, locks, timers or access hydration after the final identity check. | Existing `commitHttp` takes hydrated inputs and sends HTTP directly after the shared HTTP assertions. Deletion intent is durable before that boundary; committed steps disarm compensation before ledger retirement. New destination assertions are synchronous and run before the helper. | Same 70 scenarios in `round 71 shape b: %s performs no local async work after the final HTTP identity check`; IndexedDB and Web Locks instrument every destructive request. |
| Keep round 67 closed: content validators never replace captured access discovery. | Every final target, policy, parent, source, survivor, rollback and quarantine check still routes through `checkIdentity`, directly or through `checkResourceIdentity` / `commitHttp`. No new final HEAD/GET was added. | Expanded `round 71 final discovery: $step refuses changed captured $change on its conditional HEAD`: 70 endpoint variants and 70 captured-mode variants. Each identity at each selected boundary is changed in turn; the intended mutation stops and no foreign ACL is rewritten. |
| Requested partial Restore: compare archived original sharing rather than private recovery sharing. | Audited `recoveryPolicy`, public `bindAccess`, `preparePolicies`, `mergeContainer` and `restoreMissing`; existing archive comparison remains correct. | Added `round 71: partial Restore preserves $sharing person sharing on an unchanged $kind after refused Trash DELETE`: own/inherited person-specific sharing for file/folder, after 403. It verifies owner-only recovery, successful duplicate retirement and unchanged original policy/bytes/sharing. Retained round 69/70 cases additionally cover public sharing and 403/412 refusals. |

Other changed paths: the three test files above, this audit, and
`src/apps/drive/lib/client/README.md`. Those four production files, three test files
and two documentation files are the complete changed-path inventory.

## Failing-before evidence

The initial tests ran before production edits: 21 destination regressions and all
five UI cases failed. Both fixture controls passed and demonstrated owner Read
and Control changing from permitted to 403 after a raw empty ACL PUT.

The expanded destination/UI tests were then run with the complete production diff
removed and automatically restored afterward: **38 failed, 5 passed**. Only the
safe-name and raw-fixture controls passed. Subsequent additions extend encoded
custom endpoint coverage and the already-fixed shared-original Restore behavior;
they do not claim newly discovered ordering/Restore production defects.

Additional disposal regressions ran before extending the source/DELETE guard: all three failed. Direct Delete incorrectly resolved after removing the existing policy; Move/Rename lacked the clear resource-kind refusal. They now share the ordinary-content invariant.

The completed focused runs pass **52 round-71 tests** and **282 boundary tests**
(70 shape-a, 70 shape-b, 140 endpoint/mode discovery, two bootstrap checks).
The round-69/70 shared-original cases also passed during the focused audit.

## Every irreversible-step scenario

Every scenario below runs through both ordering tables and both final-discovery
variants. Missing-discovery scenarios explicitly require an early refusal;
they never silently skip a boundary. The final-discovery table exercises each
policy, parent, source, survivor and target assertion at the selected boundary.
Empty conditional creation never authorizes confidential bytes without its own
strong PUT receipt and subsequent verified access.

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
| `lib/client/client.ts` | `finalIdentity`, `checkResourceIdentity`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`; `listing`, `list`, `stat`, file/folder `snapshot`, `read`, `readVersion`, `readRdf`, `verifySnapshotIdentity`. |
| `lib/client/client.ts` | `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`; `guardedWrite` backup GET, placeholder, conditional payload, parent/target assertions, completion and both compensation branches; `write` owner-only protection and folder metadata; the four empty `rawPut` callers (`guardedWrite`, owner-only `write`, `provision.putFolder`, file `copySnapshot`). |
| `lib/client/client.ts` | `quarantine` private folder/backup creation, survivor assertions, conditional clearing and completion; `replayProtected`, `replayOrQuarantine`; `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, direct/recursive `remove`, survivor checks and private recovery after committed deletion. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`; ordinary Move `affected`, `bindDestination`, `verifyAccess`, destination capture, `verifyDestination`, renewed access consent, source deletion, completion and Undo receipts; `rollback`, `secureRetained`. |
| `lib/client/client.ts` | `mergeContainer`, `verifyMerge`, metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; `exclusive` and public write/copy/move/remove wrappers. Partial Restore's access comparison uses the archived original grants. |
| `lib/client/access.ts` | `assertContentDestination`, `discover`, `captureEndpoint`, `verifyEndpoint`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured-source checks, `acceptCreation`, `identities`, `verifyEndpoint`, `installed`, `recheck`, `retire`, `rollback`, destination policy; `projectAccess`, `materializeAccess`, `retargetAccess`, `accessGains`, `intersectAccess`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`; ledger/lock/serialization work precedes final mutation checks. The outer creation compensation delegates to the same empty conditional PUT boundary. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; durable intent, conditional DELETE, definitive refusal, ambiguous settlement, synchronous compensation disarm and parent receipts before later ledger retirement. |
| `lib/client/container-versions.ts`, `cleanup.ts`, `protection-ledger.ts`, `source-operations.ts` | `track`, `prepare`, `identity`, `current`, `committed`; only atomic own-mutation receipts advance parents; `discardVersion`, `ownsEmptyContainer`; protection/deletion ledger hydration, migration, persistence and retirement; source reservations and Web Locks. A later read never rebases a refused cleanup. |
| `lib/operations/operations.ts` | `uploadFile` fail/Replace/Keep both, `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`. |
| `lib/operations/operations.ts` | `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`; `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` metadata merge, duplicate file/folder disposal, unsettled Copy and settled Move; `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Purge retains the identities from its initial list; final mutations are not authorized by the later existence read. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, `readRoot`, `validateRoot`, `initialize`, `register`, `resume`; empty conditional root creation, conditional root/description marker PATCH, Type Index PUT; original index ETag and discovery remain pinned. |
| `state/ui.tsx`, `state/undo.ts`, `state/uploads.ts` | Dialog/toast captures; `refreshAfter`, Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash/source deletion; `confirmedAbsent` is read-only preference cleanup; `moveWithValidator`, reverse tree guards, rollback receipts; upload `pump`, `confirm`, `resolve`, Retry, Replace renewal, final invalidation; `reportFailure`, `errorMessage`, pending-deletion Retry. |
| `state/resource.ts`, `state/access.ts`, `state/access-confirmation.tsx`, `components/dialogs.tsx`, `components/views.tsx`, `components/protection-banner.tsx` | `withHydratedMetadata`, `useLiveResource`, `useLiveItems`, `useResourceVersion`, access-label hydration and queued consent; Rename/Move/source deletion confirmation captures; `TrashView.load`, subtree subscription, Restore action and Delete forever/Empty Trash entry snapshots; protection Delete's original ETag/discovery. |
| `state/drag-items.ts`, `components/file-browser.tsx`, `components/breadcrumbs.tsx` | `captureDragItems`, `takeDragItems`, `clearDragItems`; list/grid drag start/end and folder/breadcrumb drops; command target resolution, selection/listing reconciliation, route-unmount Details cleanup, menu dispatch. A drop consumes the initiating client's immutable capture. |
| `components/details.tsx`, `components/preview.tsx`, `components/item-menu.tsx`, `components/upload-dock.tsx` | Details/live resource commands, preview reads and action dispatch, item/Trash menus, upload conflict decisions and error rendering. None introduces a direct destructive HTTP request or substitutes post-confirmation metadata. |
| `components/drive-app.tsx`, `state/drive-context.tsx`, `state/purge-marker.ts` | Startup purge, session marker, result/failure reporting and settlement invalidation; usage subtree subscription; `DriveProvider.invalidate`, session push subscription and pending-deletion startup reconciliation; `useFolder` generation-scoped reload. This is the only purge invocation in production. Explicit actions already reconcile in `refreshAfter`/`finally`; queued uploads reconcile in `pump.finally`; provisioning emits its settlement callback. |

Solid provides no transactions. The agreed residual remains a concurrent edit
between requests: conditional mutations refuse replacements, detected content or
access disagreement stops further disposal, recovery survives, and the user sees
the failure. No additional recheck or unconditional foreign ACL/content repair
was introduced to hide that limitation.

## Validation

All required checks ran from `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **288 files, 13,169 tests passed**, exit 0.
  The JSON summary independently confirms **481 configured source files**, each
  at **100% statements, branches, functions and lines**. Coverage globs and
  thresholds are unchanged. This final run includes all three disposal regressions
  and the completed source/DELETE guard.
- `npx tsc --noEmit -p .`: passed, exit 0, on the final source/tests.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

The focused run passed all **334** cases (52 round-71 and 282 boundary tests).
The preceding full run also passed 13,166 tests at 100%; it was repeated because
source-disposal guards and their three regressions landed after it started.
Playwright was skipped because localhost listeners are unavailable, as requested.
No package/font/dependency change, external network call, listener or commit was made.
