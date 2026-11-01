<!-- AUTHORED-BY Codex -->

# Drive review round 73

## Findings, classes and regression evidence

| Finding | Class and shared fix | Regression |
| --- | --- | --- |
| Both medium missing child/sibling ACL Link reports | Incomplete namespace discovery was treated as a complete proof. `client.ts:discoverContentTargets` now applies one `requireDiscovery` invariant to the storage HEAD, each containment GET and every child HEAD. Missing WAC/ACP discovery refuses before any mutation; only the explicit demo capability permits no ACL. Every public mutation, bootstrap and resume already shares this traversal. The helper also normalizes the proven Link value, keeping the no-Link fallback with the explicit demo capability rather than after real-pod discovery has ruled it out. | `drive-review-round73.test.ts`: `round 73: missing namespace Link on $method $resource stops all writes`, five cases, including the owner-enforcing custom ACL fixture. `drive-review-round72.test.ts`: all 13 public mutation/provisioning/transfer variants now also hide the sibling Link and require zero mutations. |
| Medium recursive deletion retry discards descendant validators | A restarted destructive preflight silently authorizes a different tree. `operations.ts:removeTrashItem` performs one traversal and reports “The folder changed during deletion. Refresh Trash and confirm deletion again.” if a descendant vanishes while the root remains. Delete forever, Empty Trash and startup purge all share this path. `TrashTraversalChangedError` preserves the original cause and the shared UI error formatter displays its explanation and retained recovery locations. A fresh user action may capture a new tree; an automatic retry cannot. | `round 73: %s never recaptures descendants after a stale traversal`, three entry points. The root stays unchanged, A is captured, Z disappears, A becomes B, and the server supplies no parent receipts. B remains intact and receives no DELETE. The round 64 stale-traversal test now explicitly requires one invocation and the explanatory error. |
| Medium renewed Move access consent replaces source policies and descendant validators | Destination consent was incorrectly treated as renewal of source approval. `client.ts:transfer` carries the complete original `SourceSnapshot` through its only recursive retry, including every content validator, discovery assertion, body and source access binding. Before restarting work it verifies the retained bindings and snapshot identities through the existing shared helper. It never reruns `snapshot` for that retry. | `round 73: renewed Move consent retains captured %s`, four variants: inherited ACL, own ACL, descendant content and descendant discovery. The dialog adds Bob or changes a descendant after rollback; the operation refuses, retains the source, preserves the foreign change and sends no mutation after consent. |
| Requested partial Restore comparison | `recoveryPolicy`, `preparePolicies`, public `bindAccess`, `mergeContainer` and `restoreMissing` already use the archived original audience. No production change was needed. | Added `round 73: partial Restore of an unchanged shared %s uses its archived original audience`, file/folder with own shared original policy and refused Trash DELETE. Recovery is owner-only, the original stays shared, Restore succeeds and retires only the duplicate. Existing inherited/person-specific audience tests remain enabled. |

The completed round-73 regression file was run with **`client.ts` and `operations.ts` restored
temporarily to HEAD**, restored automatically in `finally`: **8 failed, 6 passed**. The eight
failures comprise the hidden child Link, all three lost-descendant cases and all four renewed
consent cases. The six passing controls cover existing folder/root discovery disagreement and
already-correct shared Restore behavior. The UI formatter regression separately failed before
`failureMessage` recognized the new typed traversal error; it previously hid the explanation
behind “Couldn’t delete”. This is failing-before evidence for every distinct reported defect,
including both duplicate namespace reports.

## Both ordering shapes and final discovery

`drive-review-round54-boundaries.test.ts` now enumerates **75 irreversible-step scenarios**,
adding file and folder Move after renewed access consent. Each scenario runs once for shape (a)
(replacement preservation), once for shape (b) (local asynchronous work ordering), and twice
for final discovery (changed ACL endpoint and changed captured modes). The discovery cases
independently change every policy, parent, source, survivor and target assertion at the chosen
boundary. Missing-discovery refusal is asserted explicitly where a boundary cannot be reached.
Shape (b) records IndexedDB operations, Web Locks **and timers**, requiring the last recorded
operation before each destructive request to be its HTTP identity HEAD.

All final checks still use `commitHttp` / `commitIrreversible` / `checkIdentity`, directly or
through `checkResourceIdentity` and `verifySnapshotIdentity`. The helper takes hydrated HTTP
inputs, synchronous discovery assertions and captured validators. Hydration callbacks run
before its final HTTP assertions. No new final check bypasses it. Conditional mutations and
synchronous compensation disarming remain in that shared boundary.

The 75 scenarios are the complete round-72 list, plus `renewed-consent move` and
`renewed-consent move tree`: Trash index overwrite; Move/Rename/Trash/remove; recursive remove;
Delete forever/Empty Trash/startup purge (files and trees); overwrite and folder metadata;
Restore and partial file/folder Restore (private and shared); copy/upload/Keep both/unconditional
creation payloads; ACL overwrite; replacement/upload/new-folder/copy/container rollback;
metadata Undo; policy archive/receipt/slot/ancestor cleanup; owner-only ACL/file/folder overwrite;
private folder ACL; protection receipt repair; retained/replay/completion/verification-failure
recovery clearing; container merge; partial Restore metadata; missing-Link rollback; independent
child-default rollback; inherited replacement rollback; provisioning ACL; private backup ACL;
deny-all transfers; root/description PATCH; Type Index overwrite; safe/custom-name content paths.

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


The audit re-ran the HEAD/GET, conditional-request, PUT/PATCH/DELETE and helper greps across
all paths above. The two restarting destructive preflights were the only new capture-replacement
defects found. Keep-both retries still create a new vacant name with `If-None-Match: *`; index
writes and cleanup never rebase refused validators. Presence and ambiguous-delete settlement
reads are read-only and cannot authorize subsequent destructive requests. Namespace HEADs
never supply content validators. Partial Restore uses archived original grants. A conditional
rollback cannot replace another client's content or ACL.

Solid has no transactions. The accepted inter-request concurrency gap remains conditional and
reported; this pass does not add final checks to conceal that residual. The new Move checks
validate retained approval before a restarted attempt, and every actual mutation still has
its existing shared final HTTP boundary.

## Every changed path

All paths are under `apps/suite/`:

- `src/apps/drive/lib/client/client.ts`: namespace discovery invariant and complete retained transfer snapshot.
- `src/apps/drive/lib/operations/operations.ts`: single destructive Trash traversal and explanatory refusal.
- `src/apps/drive/lib/client/README.md`: retained-snapshot and incomplete-discovery guarantees.
- `src/apps/drive/state/ui.tsx`: shared failure formatter exposes the typed stale-traversal explanation.
- `test/drive-review-round73.test.ts`: failing-before regressions and own shared Restore controls.
- `test/drive-review-round73-ui.test.ts`: explanatory UI message and preserved nested recovery locations.
- `test/drive-mergegate-round14.test.ts`: hidden namespace Link now refuses a concurrent upload before the provisioning flight; verified-discovery uploads still wait.
- `test/drive-review-round58.test.ts`: hide the ACL Link after complete namespace hydration so the existing later owner-only refusal remains covered.
- `test/drive-mergegate-round17-ui.test.ts`: missing discovery refuses the initial upload and any confirmed Retry before PUT; exposed discovery still exercises identical-content-ETag replacement confirmation.
- `test/drive-mergegate-round7-ui.test.ts`: metadata/view fixtures register their existing root, avoiding unrelated root creation while testing read-only hidden-Link views.
- `test/drive-safety.test.ts`: stale descendant cases require exactly one traversal, including when another disappearance was waiting for the removed automatic retry.
- `test/drive-review-round72.test.ts`: hidden-Link variants across every public mutation entry point.
- `test/drive-review-round64.test.ts`: stale traversal must stop, never retry.
- `test/drive-review-round54-boundaries.test.ts`: 75-scenario matrices, renewed-consent moves and timer tracing.
- `test/drive-review-round17-ui.test.ts`: after a full-run-only failure, assert deletion success and flush React/IndexedDB inside the row-removal wait; both prior isolated runs already passed. The focus and removal assertions are preserved.
- `test/drive-review-round73-audit.md`: this finding, path, call-site and verification record.

Packages, fonts, dependencies and coverage configuration/thresholds are unchanged. No commits,
external network access, publishing or localhost listeners. Playwright is skipped as requested.

## Validation

All required commands ran from `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **292 files, 13,261 tests passed**, exit 0. Independent inspection of `coverage/coverage-summary.json` confirms all **481 configured source files** have **100% statements, branches, functions and lines**. The global totals are 19,802 statements, 14,050 branches, 3,640 functions and 17,393 lines, all covered. No coverage glob or threshold changed.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

The expanded matrix and adjacent regressions passed **417 tests across five files**. The final namespace-normalization check passed **104 tests across three files**. Earlier full-run failures are accounted for above: existing fixtures now reach the intended early or later refusal, and the Search-focus wait flushes React/IndexedDB while retaining its success, removal and focus assertions. Link normalization now belongs to the shared discovery helper, removing the unreachable post-discovery fallback without lowering coverage. The final 100% run includes all of these changes, both shared Restore cases, and every irreversible-step scenario.

All **16 changed paths** are listed above and remain under `apps/suite`. Changes are uncommitted. Packages, dependencies, fonts, coverage configuration and thresholds are unchanged. Playwright was skipped as requested; no build/font workaround was needed.
