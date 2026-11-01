<!-- AUTHORED-BY Codex -->

# Drive review round 74

## Findings and shared invariants

| Finding / class | Fix and paths | Regression |
| --- | --- | --- |
| Medium: rollback retains revoked public access. Recovery protection depended on which failure branch ran. | `lib/client/client.ts`: one `recoveryOwnerFor` preflight for transfer (Move and Copy) and container merge; `rollback` and `secureRetained` require the captured owner argument. `secureRetained` always requests owner-only recovery, intersected with current access and conditional on the captured destination content/ACL. Both pre-deletion compensation and post-deletion retention use it. No old public policy is restored and no source recheck is needed to protect the surviving copy. | `drive-review-round74.test.ts`: `round 74: %s retains owner-only recovery when public source access is revoked before deletion` (Move, Copy, Rename, tree Move, tree Copy). Owner-enforcing WAC changes the source's public grant and WAC-Allow immediately after destination payload PUT. No DELETE is sent; signed-out source and recovery reads return 403; the owner retrieves the original bytes. `round 74: %s captures a recovery owner before creating any destination` covers Copy/container merge without a captured controller. |
| Medium: startup registration bypasses the content namespace boundary. Bootstrap's raw fetch could write ordinary RDF to an absent custom ACL. | New `lib/client/bootstrap.ts:driveBootstrapFetch` applies `discoverContentTargets` to every mutation and sends it through `commitHttp`. `state/drive-context.tsx:resolveDriveRoot` supplies this adapter to `ensureTypeRegistrations`. This covers index creation/registration, preferences creation/update, and profile updates, including custom linked targets. The adapter captures original content discovery, hydrates bodies before the final check, requires conditional requests, and refuses newer validators after a failed write; only its own mutation receipts advance approval. `components/drive-app.tsx` uses the existing error formatter to surface namespace/access/version failures at startup. | `drive-review-round74-ui.test.ts`: `round 74: startup refuses a custom ACL at bootstrap content target %s` (private Type Index and preferences). Uses the real registration implementation and owner-enforced WAC. No PUT reaches the protected endpoint; the owner retains Read and Control. Adapter tests additionally cover successive own receipts, refused-write retries, same-validator endpoint/mode changes, weak/missing validators and unconditional writes. |
| Requested partial Restore comparison | Audited `recoveryPolicy`, `preparePolicies`, public `bindAccess`, `mergeContainer` and `restoreMissing`; they already compare against the archived original policy. No production change required. | Added `round 74: partial Restore uses archived inherited sharing after refused Trash DELETE of a %s` (file/folder). The original stays anonymously readable, recovery is owner-only, Restore succeeds and deletes only the duplicate. Round-73 own shared-policy tests also remain enabled. |

Before the production changes, the initial medium-finding regressions produced
**5 failures, 3 passing controls**. The completed finding/preflight tests were
then rerun with `client.ts` and `drive-context.tsx` temporarily restored to HEAD,
automatically restored in `finally`: **8 failures, 1 passing control**. Move/Copy
and both tree variants retained anonymously readable bytes; both the index and
preferences cases wrote into an absent custom ACL; Copy and merge proceeded
without a captured recovery owner. The same-folder Rename control was already
private under the revoked parent. The strengthened preferences fixture uses an
owner-only root to reach its later bootstrap write.

## Ordering shapes and final discovery

`drive-review-round54-boundaries.test.ts` enumerates **79 scenarios**. Each runs
for shape (a), replacement preservation at the final identity check; shape (b),
no IndexedDB, Web Lock or timer work after the final HTTP identity HEAD; and final
discovery, independently changing each captured ACL endpoint and access mode.
Every policy, parent, source, survivor and target assertion at the selected
boundary is exercised. The four additions are startup index overwrite, startup
preferences overwrite, startup profile overwrite, and revoked-source recovery
ACL installation. The prior 75 scenarios remain enabled.

Final mutation checks continue to use `commitHttp` / `commitIrreversible` /
`checkIdentity`, including the new bootstrap adapter. Supplemental checks retain
both the original validator and synchronous discovery assertion. All hydration
precedes those HTTP checks. Compensation disarming remains synchronous on commit;
retirement failures cannot rearm it. All mutation requests remain conditional.

The adapter additionally refuses a registration library retry with a newer ETag,
and preserves the first endpoint/mode capture even if a second GET returns the
same content validator with changed discovery. Empty creation uses If-None-Match;
existing-target writes use the captured If-Match. It cannot create an ACL through
the content path, including a custom endpoint or an implicit ancestor.

## Every audited call site

Re-ran the HEAD/GET, conditional-request, PUT/PATCH/DELETE and commit-helper grep
across the whole Drive client, operations, provisioning, startup and UI state.
The following inventory names all inspected mutation/compensation, capture,
confirmation, and read-only settlement callers.

| Path | Audited call sites |
| --- | --- |
| `lib/client/commit.ts` | `confirmationOptions`, `discoveryOptions`, `requireResourceAssertion`, `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; target, policy, supplemental identity and protected-resource assertions; `Compensation.arm`, `disarm`, `rollback` and synchronous commit effects. |
| `lib/client/bootstrap.ts` | `driveBootstrapFetch`, `capture`, request-body hydration, fragment normalization, read captures, write-approval retention, namespace traversal and final conditional PUT/PATCH/DELETE dispatch through `commitHttp`. |
| `lib/client/client.ts` | `discoverContentTargets` storage HEAD, containment GET, child HEAD and directory discovery agreement; `prepareContentTargets`, `finalIdentity`, `checkResourceIdentity`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`; `listing`, `list`, `stat`, `snapshot`, `read`, `readVersion`, `readRdf`, `verifySnapshotIdentity`. |
| `lib/client/client.ts` | `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`; `guardedWrite` backup GET, placeholder and conditional payload, parent/target assertions, completion and compensation; owner-only `write` and metadata writes; all four `rawPut` callers (`guardedWrite`, owner-only `write`, `provision.putFolder`, `copySnapshot`). |
| `lib/client/client.ts` | `quarantine` folder/backup creation, survivor checks, conditional clearing and completion; `replayProtected`, `replayOrQuarantine`; `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, direct and recursive `remove`, survivor checks and post-commit private recovery. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`; Move `affected`, `bindDestination`, `verifyAccess`, destination capture, `verifyDestination`, renewed consent with retained `SourceSnapshot`, source deletion, completion and Undo receipts; `recoveryOwnerFor`, both `secureRetained` callers, `rollback` and both callers (transfer compensation and merge compensation). |
| `lib/client/client.ts` | `mergeContainer`, `verifyMerge`, metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; `exclusive`, public write/createFolder/prepareTrash/mergeContainer/copy/move/remove wrappers. Partial Restore binds archived original grants. |
| `lib/client/access.ts` | `assertContentDestination`, `discover`, `captureEndpoint`, `verifyEndpoint`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, source validation, `acceptCreation`, `identities`, `verifyEndpoint`, `installed`, `recheck`, `retire`, `rollback`, destination policy; `projectAccess`, `materializeAccess`, `retargetAccess`, `accessGains`, `intersectAccess`. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. All ledger/lock/serialization work precedes final mutation checks; outer creation compensation delegates to the conditional empty-PUT boundary. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; durable intent precedes final checks, conditional DELETE, refusal/ambiguous settlement, synchronous compensation disarm, parent receipts and later ledger retirement. |
| `lib/client/container-versions.ts`, `cleanup.ts`, `protection-ledger.ts`, `source-operations.ts` | `track`, `prepare`, `identity`, `current`, `committed`; only atomic own-mutation receipts advance captured parents; `discardVersion`, `ownsEmptyContainer`; protection/deletion ledger hydration, migration, persistence and retirement; source reservations and Web Locks. Refused cleanup cannot rebase to a later read. |
| `lib/operations/operations.ts` | `uploadFile` fail/Replace/Keep both, `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`. |
| `lib/operations/operations.ts` | `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`; `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` metadata merge, file/folder duplicate disposal, unsettled Copy and settled Move; `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. Trash traversals never retry with a new tree capture; purge keeps its initial entry captures. |
| `lib/model/root.ts` | `discoverContentTargets`, `ensureDriveRoot`, `createRoot`, `commitRoot`, `readRoot`, `validateRoot`, `initialize`, `register`, `resume`; conditional root creation, marker/description PATCH, index PUT; index ETag and discovery stay pinned and resume refreshes namespace hydration. |
| `state/ui.tsx`, `state/undo.ts`, `state/uploads.ts` | Dialog/toast captures; `refreshAfter`, Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash/source deletion; read-only `confirmedAbsent`; `moveWithValidator`, reverse-tree guards and rollback receipts; upload `pump`, `confirm`, `resolve`, Retry, Replace renewal and final invalidation; `reportFailure`, `errorMessage`, pending-deletion Retry. |
| `state/resource.ts`, `state/access.ts`, `state/access-confirmation.tsx`, `components/dialogs.tsx`, `components/views.tsx`, `components/protection-banner.tsx` | `withHydratedMetadata`, live resource/item/version hooks, access-label hydration, consent queue and lifecycle; Rename/Move/source-delete confirmation captures; `TrashView.load`, subtree subscription, Restore and Delete forever/Empty Trash snapshots; protection Delete's original ETag/discovery. |
| `state/drag-items.ts`, `components/file-browser.tsx`, `components/breadcrumbs.tsx` | `captureDragItems`, `takeDragItems`, `clearDragItems`; drag start/end and folder/breadcrumb drops; command target resolution, selection/listing reconciliation and route-unmount Details cleanup. Drops consume their initiating client's immutable capture. |
| `components/details.tsx`, `preview.tsx`, `item-menu.tsx`, `upload-dock.tsx` | Live-resource commands, preview reads, item/Trash menus, upload conflict decisions and error rendering. No direct destructive request or post-confirmation substitution. |
| `components/drive-app.tsx`, `state/drive-context.tsx`, `state/purge-marker.ts` | Startup purge/marker and result reporting, usage subscriptions; `resolveDriveRoot` discovery, root creation and protected registration; provider invalidation, session push, pending-deletion reconciliation, generation-scoped `useFolder`; startup error rendering now exposes existing typed safety messages. |

Read-only presence, error-reporting and ambiguous-delete settlement HEADs do not
supply replacement validators to destructive requests. Namespace HEADs discover
auxiliary targets and cannot authorize content disposal. The accepted concurrency
gap between independent Solid requests remains conditional and surfaced; no
rollback overwrites another client's ACL or content to conceal it.

## Changed paths

All paths are under `apps/suite/`:

- `src/apps/drive/lib/client/client.ts`: captured recovery owner and shared owner-only retention.
- `src/apps/drive/lib/client/bootstrap.ts`: guarded registration transport.
- `src/apps/drive/lib/client/README.md`: recovery/bootstrap guarantees and audit link.
- `src/apps/drive/state/drive-context.tsx`: guarded startup registration.
- `src/apps/drive/components/drive-app.tsx`: typed startup failure messages.
- `test/drive-custom-acl-pod.ts`: owner/public WAC enforcement shares one transport for authenticated and signed-out requests.
- `test/drive-review-round54-boundaries.test.ts`: 79-scenario matrices for both ordering shapes and final discovery.
- `test/drive-mergegate-round9-ui.test.ts`: await guarded registration settlement; concurrent first-open tests cover both an existing and an absent index, preserve the winner, and never rebase an overwrite. Intercepted WAC write receipts expose the same ACL Link/model as normal responses.
- `test/drive-review-round56-edges.test.ts`: its no-controller Copy case now requires preflight refusal and zero mutations; its independent failed-backup recovery case remains enabled.
- `test/drive-review-round74.test.ts`: revoked-source recovery, owner preflight, bootstrap capture/retry checks, shared partial Restore, and evacuation refusal that preserves created bytes and a concurrent ACL.
- `test/drive-review-round74-ui.test.ts`: real startup registration collision regressions.
- `test/drive-review-round74-audit.md`: findings, classes, paths, complete call-site inventory and validation.

No packages, fonts, dependencies, coverage configuration or thresholds changed.
Changes remain uncommitted. No external network calls, publishing or localhost
listeners; Playwright is skipped as requested.

## Validation

All commands ran from `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **294 files, 13,298 tests passed**, exit 0. Independent inspection of `coverage/coverage-summary.json` confirms **all 482 configured source files** have **100% statements, branches, functions and lines**. Totals: 19,846 statements, 14,078 branches, 3,648 functions and 17,432 lines, all covered. No coverage glob or threshold changed.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

The expanded matrices and adjacent regressions passed **375 tests across four
files**. The adapter separately reached 100% coverage in its focused run. The
older Copy-without-controller expectation was updated to require preflight
refusal and zero mutations. That earlier refusal removed coverage of an existing
quarantine guard; the added standalone-creation evacuation test reaches it while
asserting that Drive preserves both created bytes and a concurrent ACL without
DELETE or ACL repair. The final full run includes that case and all prior tests.

All **12 changed paths** are listed above and remain under `apps/suite`.
Changes are uncommitted. Packages, fonts, dependencies and coverage configuration
are unchanged. Playwright was skipped as requested; no font/build workaround
was needed.
