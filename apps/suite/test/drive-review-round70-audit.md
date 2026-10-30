<!-- AUTHORED-BY Codex -->
# Drive review round 70

All paths below are relative to `apps/suite`. Changes remain uncommitted on
`claude/DRV-04`, within this app. No dependency, package, font, listener or network
change is involved. Playwright is excluded as requested.

## Findings, classes and every changed path

| Finding / class | Fix and paths | Tests |
| --- | --- | --- |
| Medium: background mutation settlement does not reconcile subscribed UI | `src/apps/drive/components/drive-app.tsx`: startup purge invalidates `trashFolderOf(driveRoot)` in `finally`, after the entire operation settles. This reaches Trash's subtree subscription, descendant listings/metadata and usage measurement, including on failure after completed DELETEs. The existing `DriveProvider.invalidate` is the shared fan-out; no separate refresh algorithm was added. | `test/drive-review-round70-ui.test.ts`: `round 70: startup purge invalidates an already loaded Trash when %s without push`, resolved and rejected-after-deletion variants. Real DriveApp and TrashView against the in-memory WAC pod; hold DELETE until the expired row and enabled Restore/Empty trash actions are visible. After release, storage and index are empty, the row and Restore action disappear, and Empty trash is disabled. |
| Related audit finding: background purge hides conditional refusals and rejected promises | `src/apps/drive/components/drive-app.tsx` uses the existing action failure reporter for both `result.failed` and promise rejection. `src/apps/drive/state/ui.tsx` exports `reportFailure`, sharing conflict, access-change, recovery-location and pending-deletion Retry guidance with explicit actions. No new validator or retrying DELETE is introduced. | The same UI table's refused-DELETE variant replaces the item while the original conditional DELETE is held. Drive preserves the replacement and reports `This item changed. Refresh and try again.` The rejected-after-deletion variant requires a visible error as well as revalidation. |
| Requested shape (a): replacing a confirmed validator/discovery with a later read | Whole-client and operations audit below. Existing `confirmationOptions`, `ResourceAssertion`, `commitHttp`, and `checkIdentity` already preserve the capture. No additional production boundary change is needed. | `test/drive-review-round54-boundaries.test.ts`: `round 70 shape a: %s retains a replacement at its final identity check`, now 67 variants. Added startup purge and startup purge tree, both using real `purgeExpired`, alongside all existing steps. |
| Requested shape (b): local asynchronous hydration between final identity check and mutation | Whole-client audit below. `commitHttp` already takes hydrated request data; callback/ledger/lock/serialization work precedes its HTTP checks. The helper sends the request directly after those checks. `deletionControl.remove` persists intent before entering the boundary and disarms compensation before retirement. No new checks are added between requests. | The same 67 variants in `round 70 shape b: %s performs no local async work after the final HTTP identity check`. IndexedDB and Web Locks are instrumented; every destructive request must be immediately preceded by its conditional HTTP identity HEAD. |
| Keep round 67 closed: final content checks must assert captured ACL/access discovery too | All final target, policy, parent, source, survivor, rollback and quarantine assertions retain `checkIdentity` through the existing shared helper. No separate final HEAD/GET implementation is introduced. | The same 67 variants in `round 70 final discovery: %s refuses an ACL endpoint change on its conditional HEAD`. Each captured identity at the selected boundary is changed in turn; the intended mutation stops and the foreign policy is never rewritten. |
| Requested partial Restore behavior: compare original sharing against its archive | Audited `recoveryPolicy`, public `client.bindAccess`, `preparePolicies`, `mergeContainer` and `restoreMissing`; their existing archive comparison remains correct. The private recovery ACL never replaces the original audience. | `test/drive-review-round70.test.ts`: `round 70: partial Restore compares archived $sharing sharing for a $kind after Trash DELETE $status`, eight cases: own/inherited sharing, file/folder, refused DELETE 403/412. Originals remain publicly readable, recovery is owner-only, Restore retires the duplicate recovery and index entry without changing the original policy. |

Documentation changes: this file and `src/apps/drive/lib/client/README.md`.
The complete changed-path inventory is the two source files, three test files
and two documentation files listed above.

## Failing-before evidence

Before editing production code, both initial no-push UI cases failed: DELETE and
index settlement had completed, but the expired row, Restore and Empty trash
remained displayed/enabled. Adding settlement invalidation made both pass.

The reporting assertions were added before exposing/reusing `reportFailure`.
Both failed with zero error-toast calls: a rejected promise after completed
deletion, and an actual conditional DELETE refusal after a concurrent replacement.
They pass with the shared reporter. The refusal test verifies the replacement's
bytes survive.

The boundary and shared-original Restore cases guard previously closed behavior;
they do not claim a newly reproduced production defect. The focused checks pass
227 cases: 203 boundary tests (67 variants in each of three tables plus two
bootstrap tests), 13 retained round-69 functional tests, three startup UI cases
and eight new partial-Restore cases.

## All irreversible-step variants

Each of the three tables covers these 67 variants:

- Trash index overwrite; Move; Rename; Trash; direct remove; recursive remove;
  Delete forever; Empty Trash; startup purge; overwrite; folder metadata;
  Restore; partial file Restore; partial folder Restore; Copy payload; ACL overwrite.
- Replacement rollback; Upload rollback; New folder rollback; Copy rollback;
  container rollback; metadata undo; policy archive cleanup; receipt cleanup;
  slot cleanup; ancestor cleanup; owner-only ACL; owner-only overwrite;
  owner-only folder overwrite; private folder ACL; protection receipt repair.
- Retained recovery clearing; replay recovery clearing; container merge;
  partial folder Restore metadata; Copy rollback without Link; container rollback
  without Link; folder overwrite rollback with child defaults; partial Restore
  rollback with child defaults; inherited replacement rollback; container
  provisioning ACL; metadata undo recovery clearing; post-retirement private backup ACL.
- Move tree; Rename tree; Trash tree; Restore tree; Delete forever tree;
  Empty Trash tree; startup purge tree; Replace completion recovery clearing;
  Move completion recovery clearing; Copy completion recovery clearing;
  shared partial file Restore; shared partial folder Restore;
  verification and replay failure clearing.
- Upload payload; Keep both payload; unconditional creation payload;
  deny-all Copy payload; deny-all Move; deny-all Rename; deny-all Trash;
  deny-all Restore; root marker PATCH; description marker PATCH; Type Index overwrite.

Missing-discovery cases can refuse before the selected cleanup boundary; the
tables explicitly require that refusal rather than silently skipping the case.
The discovery table exercises each policy/parent/source/survivor/target identity
in the selected boundary. Empty conditional creation is permitted before access
discovery; payload overwrites require the original strong placeholder receipt.

## Every audited call site

Paths in this table are under `src/apps/drive/`. The grep inventory includes
HEAD/GET, If-Match/If-None-Match, PUT/PATCH/DELETE, and shared helper callers in
client, access, deletion, commit, operations and UI state, plus provisioning and
root initialization. Planning, error-reporting and ambiguous-delete settlement
reads do not authorize a new mutation. The existing shared boundary supplies
final assertions after their local work.

| Path | Audited call sites |
| --- | --- |
| `lib/client/commit.ts` | `confirmationOptions`, `discoveryOptions`, `requireResourceAssertion`, `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; target, policy, supplemental identity and protected-resource assertions; `Compensation.arm`, `disarm`, `rollback`, synchronous commit effects. |
| `lib/client/client.ts` | `finalIdentity`, `checkResourceIdentity`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`; `listing`, `list`, `stat`, file/folder `snapshot`, `read`, `readVersion`, `readRdf`, `verifySnapshotIdentity`. |
| `lib/client/client.ts` | `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`; `guardedWrite` backup GET, placeholder, conditional payload, parent/target assertions, completion and both compensation branches; `write` owner-only protection and folder metadata; the four empty `rawPut` callers (`guardedWrite`, owner-only `write`, `provision.putFolder`, file `copySnapshot`). |
| `lib/client/client.ts` | `quarantine` private folder/backup creation, survivor assertions, conditional clearing and completion; `replayProtected`, `replayOrQuarantine`; `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, direct/recursive `remove`, survivor checks and private recovery after committed deletion. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`; ordinary Move `affected`, `bindDestination`, `verifyAccess`, destination capture, `verifyDestination`, renewed access consent, source deletion, completion and Undo receipts; `rollback`, `secureRetained`. |
| `lib/client/client.ts` | `mergeContainer`, `verifyMerge`, metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; `exclusive` and public write/copy/move/remove wrappers. Partial Restore's access comparison uses the archived original grants. |
| `lib/client/access.ts` | `discover`, `captureEndpoint`, `verifyEndpoint`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured-source checks, `acceptCreation`, `identities`, `verifyEndpoint`, `installed`, `recheck`, `retire`, `rollback`, destination policy; `projectAccess`, `materializeAccess`, `retargetAccess`, `accessGains`, `intersectAccess`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`; ledger/lock/serialization work precedes final mutation checks. The outer creation compensation delegates to the same empty conditional PUT boundary. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; durable intent, conditional DELETE, definitive refusal, ambiguous settlement, synchronous compensation disarm and parent receipts before later ledger retirement. |
| `lib/client/container-versions.ts`, `cleanup.ts`, `protection-ledger.ts`, `source-operations.ts` | `track`, `prepare`, `identity`, `current`, `committed`; only atomic own-mutation receipts advance parents; `discardVersion`, `ownsEmptyContainer`; protection/deletion ledger hydration, migration, persistence and retirement; source reservations and Web Locks. A later read never rebases a refused cleanup. |
| `lib/operations/operations.ts` | `uploadFile` fail/Replace/Keep both, `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`. |
| `lib/operations/operations.ts` | `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`; `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` metadata merge, duplicate file/folder disposal, unsettled Copy and settled Move; `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Purge retains the identities from its initial list; final mutations are not authorized by the later existence read. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, `readRoot`, `validateRoot`, `initialize`, `register`, `resume`; empty conditional root creation, conditional root/description marker PATCH, Type Index PUT; original index ETag and discovery remain pinned. |
| `state/ui.tsx`, `state/undo.ts`, `state/uploads.ts` | Dialog/toast captures; `refreshAfter`, Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash/source deletion; `confirmedAbsent` is read-only preference cleanup; `moveWithValidator`, reverse tree guards, rollback receipts; upload `pump`, `confirm`, `resolve`, Retry, Replace renewal, final invalidation; `reportFailure`, `errorMessage`, pending-deletion Retry. |
| `state/resource.ts`, `state/access.ts`, `state/access-confirmation.tsx`, `components/dialogs.tsx`, `components/views.tsx`, `components/protection-banner.tsx` | `withHydratedMetadata`, `useLiveResource`, `useLiveItems`, `useResourceVersion`, access-label hydration and queued consent; Rename/Move/source deletion confirmation captures; `TrashView.load`, subtree subscription, Restore action and Delete forever/Empty Trash entry snapshots; protection Delete's original ETag/discovery. |
| `state/drag-items.ts`, `components/file-browser.tsx`, `components/breadcrumbs.tsx` | `captureDragItems`, `takeDragItems`, `clearDragItems`; list/grid drag start/end and folder/breadcrumb drops; command target resolution, selection/listing reconciliation, menu dispatch. A drop consumes the initiating client's immutable capture. |
| `components/details.tsx`, `components/preview.tsx`, `components/item-menu.tsx`, `components/upload-dock.tsx` | Details/live resource commands, preview reads and action dispatch, item/Trash menus, upload conflict decisions and error rendering. None introduces a direct destructive HTTP request or substitutes post-confirmation metadata. |
| `components/drive-app.tsx`, `state/drive-context.tsx`, `state/purge-marker.ts` | Startup purge, session marker, result/failure reporting and settlement invalidation; usage subtree subscription; `DriveProvider.invalidate`, session push subscription and pending-deletion startup reconciliation; `useFolder` generation-scoped reload. This is the only purge invocation in production. Explicit actions already reconcile in `refreshAfter`/`finally`; queued uploads reconcile in `pump.finally`; provisioning emits its settlement callback. |

Solid has no transactions. A concurrent content or ACL edit between two requests
remains the agreed residual: conditional mutations refuse replacements, observed
disagreement stops further disposal, recovery remains available, and the user sees
the failure. No extra recheck, foreign ACL/content repair, or refreshed-validator
compensation was added.

## Validation

All requested checks ran from `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **286 files, 13,038 tests passed**, exit 0.
  The JSON summary independently confirms all **481 configured source files**
  have **100% statements, branches, functions and lines**, with no file below
  any threshold. Coverage globs and thresholds are unchanged.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

The focused run passed all 227 cases described above. The before-fix UI failures
and before-reporter failures are recorded in the failing-before section.
No commit, package/font change, external network call or localhost listener was
added. Playwright was skipped as requested. No font/build workaround was needed.
