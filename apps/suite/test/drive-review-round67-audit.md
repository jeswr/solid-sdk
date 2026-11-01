<!-- AUTHORED-BY Codex -->
# Drive review round 67

Source paths in the finding and audit tables are relative to
`apps/suite/src/apps/drive`. The complete changed-path inventory and validation
commands are relative to `apps/suite`. No commits, dependency/shared-package/font
changes, external network access, or localhost listeners were added.

## Findings, classes, and regression tests

| Finding/class | Fix and changed source paths | Regression |
| --- | --- | --- |
| Moved multi-selection Details retains stale snapshots | Generalize resource hydration to a selection; subscribe to every member's current parent and fence responses by client, selection, activation, and invalidation. `state/resource.ts`, `components/details.tsx`. | `drive-review-round67-ui.test.ts`: `round 67: moved multi-selection Details refreshes every member after queued Replace (%s)` covers replacing either member through the real provider, queue, and in-memory WAC pod. |
| Expanded tree names include descendants | Each tree item gets its own folder name as its accessible label. `components/dialogs.tsx`. | `round 67: expanded Move tree items are named only by their own folder` asserts root, expanded parent, and descendant labels. |
| Captured validator/discovery is lost between confirmation and commit | `confirmationOptions` transports the validator and synchronous discovery assertion together; deduplicating equal policy validators composes every captured assertion instead of replacing one. `lib/client/commit.ts`, `lib/client/client.ts`, `lib/client/access.ts`, `lib/operations/operations.ts`, `lib/operations/trash-index.ts`, `state/ui.tsx`, `state/undo.ts`, `components/protection-banner.tsx`. Read APIs and move receipts carry discovery; relocation drops the old resource's receipt. Renewed Move consent retains its approved destination policy rather than a later read, including identical-grant replacements. Policy/archive, survivor, compensation, quarantine, and own-ACL captures retain their assertions. | `drive-review-round67.test.ts`: `round 67 confirmation: %s carries captured discovery into preflight and the final step` covers Replace, Move, Copy, Rename, Trash, remove, owner-only overwrite, folder metadata, Restore, partial Restore, Delete forever, Empty Trash, and ACL overwrite. `round 67 confirmation: renewed Move consent never adopts a later destination policy validator` reproduces the retry instance with a replacement after the second consent. |
| Final content checks omit ACL discovery or access modes | Every final HTTP identity check goes through `checkIdentity`; its pre-hydrated synchronous assertion pins the ACL/ACP discovery and captured access-mode headers. `lib/client/access.ts`, `lib/client/client.ts`, `lib/client/commit.ts`, `lib/client/deletion.ts`, `lib/operations/operations.ts`, and the receipt transport paths above. Conditional creation receipts alone authorize a new creation binding. Read-only captures can describe external shared resources without resolving their ACLs. | `round 67 discovery: content identity cannot excuse changed access model` covers ACP headers/relations, demo discovery, ACR modes, and WAC-Allow. `round 67 discovery: final writes retain explicit no-ACL discovery without an own ACL` covers a final response losing both the explicit demo declaration and Link header. `round 67 discovery: a captured assertion does not retain mutable response headers` checks immutability. `round 67 discovery: duplicate policy guards preserve the $order captured assertion` checks both changed and unchanged discovery, retaining one HTTP check. The 54-variant final-discovery matrix changes every captured identity at its intended commit boundary. |
| Non-HTTP work after final check; compensation after commit | `commitHttp` takes hydrated requests and synchronous assertions; helper-owned raw conditional HEADs precede the request. Ledger writes, locks, policy reads and proof hydration stay before those checks; committed compensation is disarmed before later bookkeeping. `lib/client/commit.ts`, `lib/client/deletion.ts`, and all audited callers below. | `drive-review-round54-boundaries.test.ts`: `round 67 shape a: %s retains a replacement at its final identity check`; `round 67 shape b: %s performs no local async work after the final HTTP identity check`. |
| Partial Restore compares private recovery rather than original sharing | `client.bindAccess` and `mergeContainer` compare archived original policy; the existing comparison remains intact. Discovery/validator transport now also survives shared-original recovery. | `drive-review-round66.test.ts`: `round 66: unchanged shared %s Restore compares the archived original after refused Trash DELETE`, file and folder. Earlier round-54 and round-65 shared-original tests remain active. |
| Access mismatch is hidden by generic upload status | Surface `DriveAccessError.message` through the queue. `state/uploads.ts`. | `round 67: queued Replace reports a changed confirmed ACL endpoint and keeps the file` checks the message, unchanged bytes, and untouched foreign policy. |
| Missing discovery proof can become an unguarded supplemental identity | `discoveryOptions` transports existing assertions without refreshing them; `requireResourceAssertion` requires proof before source/survivor hydration or Undo reads. Final `checkIdentity` rejects any existing policy without its capture. `lib/client/commit.ts`, `lib/client/client.ts`, `lib/operations/operations.ts`, `state/undo.ts`. Missing-proof messages explain how to renew confirmation. `state/ui.tsx`, `state/uploads.ts`. | `round 67 discovery: %s requires a hydrated supplemental assertion`; `round 67 discovery: %s policy guards without a captured assertion cannot authorize a step`; `round 67 confirmation: Undo refuses a missing %s discovery capture before reading`; the compatibility adapter table verifies retained recovery when an adapter omits proof; `round 67: missing captured identity explains how to renew confirmation`. |
| Drive's own ACL write legitimately changes WAC-Allow | The existing protection-retirement HTTP check verifies Drive's conditional policy receipt and preserves its endpoint and access model while allowing that write's permission transition. It captures the resulting full discovery for later steps. This adds no HTTP request or asynchronous gap before a mutation. `lib/client/access.ts`, `lib/client/ancestors.ts`, `lib/client/client.ts`. Existing-policy verification retains all original mode assertions. | `round 67 discovery: %s advances modes only through its own verified ACL receipt` covers Copy, Move and Restore of private content under public inheritance, with permission-dependent WAC-Allow responses and an exposure audit after every request. All three failed before the receipt fix. `round 67 confirmation: ACL installation refuses a changed captured %s before hydration` covers ETag and discovery mismatches before policy installation. |
| Policy verification preserves only ETag and refreshes discovery | Captured policy comparisons and post-PUT verification send the captured If-Match and assert the captured policy-document discovery before returning a verified policy. An overwrite keeps its original discovery; only conditional creation uses a new receipt. `lib/client/access.ts`. The same `captureEndpoint` assertion used at final HEAD boundaries verifies the GET response; neither a PUT response, read nor bookkeeping callback can replace the original baseline. | `round 67 discovery: %s retains the policy document's own discovery` covers captured policy comparison, post-PUT verification, and an overwrite whose PUT and GET both advertise the replacement endpoint. All three resolved successfully before their fixes and now refuse changed discovery. `policy comparisons assert the response ETag when HTTP ignores If-Match` verifies the content half of that assertion too. |
| Verified and legacy policy receipts need consistent transport | `resourceDiscoveryOptions` provides the shared transport for installed bindings and created-resource guards, retaining the previous capture when no verified resource receipt is present. `lib/client/access.ts`, `lib/client/client.ts`. | `round 67 discovery: a legacy policy projection retains the protected-resource capture` verifies unchanged and changed WAC-Allow after installing a projection without a resource receipt. The verified-receipt cases exercise the other side of the shared transport. |

The first 22 new functional/UI cases failed against original `HEAD` source in
isolated `/tmp/drive67-before` before passing with the fixes. The access-mode, mutable-header, duplicate-guard, renewed-consent, and explicit
no-ACL cases were also reproduced failing before their fixes.
The working tree was never replaced during reproduction.

## Irreversible-step matrices

`drive-review-round54-boundaries.test.ts` has three tables over the same **54
variants**: captured-validator replacement, IndexedDB/Web Lock ordering, and final
ACL discovery. The discovery table changes each policy, parent, source, survivor,
and target assertion from the boundary trace. It distinguishes rollback PUTs,
quarantine clearing PUTs, and cleanup DELETEs, so independently guarded cleanup
cannot be mistaken for the refused step. Missing creation discovery stops cleanup
before any irreversible boundary is reached.

| Steps covered by all three tables |
| --- |
| Trash index overwrite; Move; Rename; Trash; remove; recursive remove; Delete forever; Empty Trash; overwrite; folder metadata |
| Restore; partial file Restore; partial folder Restore; Copy payload; ACL overwrite; replacement rollback; Upload rollback; new folder rollback; Copy rollback; container rollback |
| Metadata undo; policy archive cleanup; receipt cleanup; slot cleanup; ancestor cleanup; owner-only ACL; owner-only overwrite; owner-only folder overwrite; private folder ACL; protection receipt repair |
| Retained recovery clearing; replay recovery clearing; container merge; partial folder Restore metadata; Copy rollback without Link; container rollback without Link; folder overwrite rollback with child defaults; partial Restore rollback with child defaults; inherited replacement rollback; container provisioning ACL |
| Metadata undo recovery clearing; post-retirement private backup ACL; Move tree; Rename tree; Trash tree; Restore tree; Delete forever tree; Empty Trash tree; Replace completion recovery clearing; Move completion recovery clearing; Copy completion recovery clearing |
| Shared partial file Restore; shared partial folder Restore; verification and replay failure clearing |


Drive has no PATCH request path. Physical mutations use conditional PUT or DELETE,
including ACL writes, quarantine clearing, and recovery cleanup. Conditional
creation retains If-None-Match; existing representations retain their approved
If-Match and discovery assertion.

## Every audited call site

| Path under `src/apps/drive/` | Call sites and invariant checked |
| --- | --- |
| `lib/client/commit.ts` | `confirmationOptions`, `discoveryOptions`, `requireResourceAssertion`, `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; target, policy, additional resource and ACL protected-resource guards; `Compensation.arm`, `disarm`, `rollback`; synchronous effects before later I/O. Existing targets and supplemental guards carry captured discovery into the shared `checkIdentity` boundary. |
| `lib/client/client.ts` | `finalIdentity`, `checkResourceIdentity`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`, `verifySnapshotIdentity`; file/folder `snapshot`, `stat`, `listing`, `readVersion`, `readRdf`. Captures are verified rather than refreshed. |
| `lib/client/client.ts` | `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`; scoped bindings remain available to supplemental final HEAD assertions. |
| `lib/client/client.ts` | `guardedWrite`, previous-version GET, final parent/target checks, both compensation branches; `write`, `rawPut`, `replayProtected`, `replayOrQuarantine`, `quarantine` backup writes, clearing, and completion. Payload preconditions remain immutable; quarantine checks captured backup discovery before clearing. |
| `lib/client/client.ts` | `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, direct/recursive `remove`; provisioner cleanup, Upload cleanup, tree deletion, file/folder Copy rollback and direct removal callers of `deleteVersion`. Ancestor and survivor assertions survive mapping; committed deletions disarm compensation before ledger retirement. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`; destination capture, `verifyDestination`, `bindDestination`, `verifyAccess`, `rollback`, `secureRetained`; post-retirement source/destination completion. Conditional cleanup never adopts a replacement's validator or ACL. |
| `lib/client/client.ts` | `mergeContainer`, `verifyMerge`, metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; public `exclusive` and write/copy/move/remove wrappers. Partial Restore compares archived original policy while retaining current survivor endpoint assertions. |
| `lib/client/access.ts` | `discover`, `verifyEndpoint`, `captureEndpoint`, `resourceDiscoveryOptions`, `snapshot`, `read`, `effective`, `checkOwn`, `ownAccessGuards`; `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured source validation, conditional creation acceptance, `identities`, `verifyEndpoint`, `installed`, `recheck`, `retire`, `rollback`, destination receipts/policy; `accessGains`, `intersectAccess`, `projectAccess`, `materializeAccess`, `retargetAccess`. ACL writes remain conditional against captured own policy or absence. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. Required ledger/serialization/lock work precedes final HTTP checks; creation, repair and cleanup carry the original resource discovery. Only a verified Drive ACL receipt advances protected-resource modes; cleanup preserves foreign resources and ACLs. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; durable intent before the final checks, conditional DELETE, definitive refusal and ambiguous settlement, compensation retirement before later bookkeeping. Survivor identities now require endpoint assertions. |
| `lib/client/container-versions.ts`, `cleanup.ts` | `track`, `prepare`, `current`, `identity`, `committed`; `identity` preserves assertions, and `prepare` returns assertions with its captured endpoints. Only atomic mutation receipts explain parent transitions. `discardVersion`, `ownsEmptyContainer` keep approved validators on refused cleanup. |
| `lib/client/protection-ledger.ts`, `source-operations.ts` | Protection/deletion ledger reads/writes/migration/retirement; `sourceOperation`, Web Lock acquisition/release, explicit held scopes. None intervene after the final commit-boundary identity HEAD. |
| `lib/operations/operations.ts` | `uploadFile` fail/Replace/Keep both, `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`; `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`; `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`. Confirmed versions remain pinned through retries; absent caller versions are captured at operation preflight. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` folder merge, duplicate file/folder removal, unsettled Copy and settled Move; `restoreItems`, `restoreItemsUnlocked`; `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Recovery survivors reach the same final endpoint assertion boundary. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, root marker, description marker, Type Index registration, initialization/resume. Captured conditional validators and synchronous discovery assertions remain in use. |
| `state/ui.tsx`, `state/undo.ts` | Dialog/toast snapshots, `refreshAfter`, Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash and source Delete actions; `moveWithValidator`, tree guards, reverse-move identity transport, `errorMessage`, `reportFailure`. `retargetDetails` drops source validators and discovery on relocation; Undo carries destination discovery captured inside the move. |
| `state/uploads.ts`, `state/resource.ts` | `pump`, `resolve`, Retry, Replace conflict-target capture/renewal; `withHydratedMetadata`, `useLiveItem`, `useLiveItems`, `useLiveResources`, `useLiveResource`, `useResourceVersion`, `useResourceVersions`. Every selected Details member subscribes to its current parent channel; Replace carries its captured conflict target into the operation and reports access disagreements. |
| `components/dialogs.tsx`, `protection-banner.tsx`, `views.tsx` | Rename/Move/Trash confirmation hydration, protection Delete capture, Delete forever/Empty Trash entry snapshots and batch operations. |
| `components/file-browser.tsx`, `item-menu.tsx`, `preview.tsx`, `details.tsx`, `upload-dock.tsx` | `reconcileSelection`, selection dispatch, explicit Details openers, listing Details/Preview reconciliation, successful relocation targets, loaded-file validators, metadata/access streams, upload decisions and errors. Same-URL refreshes update metadata; only actual user selection/navigation takes target ownership. |

Solid still permits another client to change access/content between requests.
Drive's conditional requests and completion checks surface that accepted residual.
Observed disagreement stops the next irreversible step, retains recovery, and
reports failure. Rollback never rewrites the foreign ACL or adopts foreign content
validators to clear another client's representation.

## Validation

All commands used `PATH=/opt/node24/bin:$PATH` from `apps/suite`:

- `npx vitest run --coverage --maxWorkers=2 --retry=1` — exit 0; **280 files and
  12,917 tests passed**, with no unhandled errors. Extra reporter flags generated
  the detailed JSON and summary reports. Every one of the **481 configured source
  files has 100% statements, branches, functions and lines**. Coverage configuration
  and thresholds are unchanged.
- `npx tsc --noEmit -p .` — exit 0.
- `npx biome check src test` — exit 0; 871 files checked, no errors, 72 warnings.
- `git diff --check` — passed. The changed-path inventory below matches the working
  tree; all changes are within `apps/suite` and no font files changed.

An earlier four-worker run hit the existing music import's 120-second size-boundary
budget; its complete file passed independently under coverage (25 tests, 100%). A
subsequent four-worker run passed every assertion and coverage threshold but caught
a test-only one-second Web Lock timeout in the durable demo UI fixture. That file
passed independently (seven tests), and the final two-worker full run exited cleanly.
No application code or timeout budget was changed to address those run conditions.

Playwright was skipped because this sandbox cannot bind localhost ports. No commit
was created; the patch remains in the working tree on `claude/DRV-04`.

## All changed paths

- `src/apps/drive/components/details.tsx`
- `src/apps/drive/components/dialogs.tsx`
- `src/apps/drive/components/protection-banner.tsx`
- `src/apps/drive/lib/client/README.md`
- `src/apps/drive/lib/client/access.ts`
- `src/apps/drive/lib/client/ancestors.ts`
- `src/apps/drive/lib/client/client.ts`
- `src/apps/drive/lib/client/commit.ts`
- `src/apps/drive/lib/client/deletion.ts`
- `src/apps/drive/lib/operations/operations.ts`
- `src/apps/drive/lib/operations/trash-index.ts`
- `src/apps/drive/state/resource.ts`
- `src/apps/drive/state/ui.tsx`
- `src/apps/drive/state/undo.ts`
- `src/apps/drive/state/uploads.ts`
- `test/drive-access-state.test.ts`
- `test/drive-access.test.ts`
- `test/drive-client.test.ts`
- `test/drive-commit.test.ts`
- `test/drive-deletion-state.test.ts`
- `test/drive-gate-boundaries.test.ts`
- `test/drive-gate-regressions.test.ts`
- `test/drive-interactions-ui.test.ts`
- `test/drive-mergegate-round11.test.ts`
- `test/drive-mergegate-round12.test.ts`
- `test/drive-mergegate-round13.test.ts`
- `test/drive-mergegate-round2.test.ts`
- `test/drive-mergegate-round23.test.ts`
- `test/drive-mergegate-round24.test.ts`
- `test/drive-mergegate-round3.test.ts`
- `test/drive-operations.test.ts`
- `test/drive-review-round50.test.ts`
- `test/drive-review-round54-boundaries.test.ts`
- `test/drive-review-round54.test.ts`
- `test/drive-review-round56-edges.test.ts`
- `test/drive-review-round56.test.ts`
- `test/drive-review-round57-boundaries.test.ts`
- `test/drive-review-round61.test.ts`
- `test/drive-review-round65.test.ts`
- `test/drive-review-round66.test.ts`
- `test/drive-review-round67-audit.md`
- `test/drive-review-round67-ui.test.ts`
- `test/drive-review-round67.test.ts`
- `test/drive-safety.test.ts`
- `test/drive-undo-ui.test.ts`
