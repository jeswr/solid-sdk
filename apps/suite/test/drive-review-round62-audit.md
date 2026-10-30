<!-- AUTHORED-BY Codex -->

# Drive round 62 audit

All paths below are under `apps/suite/`. No dependencies, shared packages, fonts,
commits, network requests, or browser servers are involved.

## Findings, classes, and changed paths

| Finding / class | Fix and every changed source path | Regression tests |
| --- | --- | --- |
| Copied policy and access binding come from independent captures. This includes changed ACL discovery, changed own ACL validators, changed inherited validators, and inconsistent resource/default reads of one policy. | `src/apps/drive/lib/client/access.ts`: `bindAccess` validates a supplied source snapshot's own endpoint and validator against its resolved policy, rejects inconsistent validators within a capture, and pins inherited policy validators on recheck. `src/apps/drive/lib/client/client.ts`: file snapshots, folder snapshots (before descending into children), and `mergeContainer` all supply their captured policy to the same invariant. Shared `capturedAccess` supplies inherited grants from that binding to transfer planning, folder merge, and Trash/archive preparation, eliminating independent effective-policy captures. `recoveryPolicy` takes a pre-hydrated `OwnAccess`, including the legacy null-archive fallback. | `drive-review-round62.test.ts`: `…rejects a copied policy whose $change disagrees with its binding before writing` (Rename, Move, Copy, each folder variant, mergeContainer; endpoint/validator); `a binding rejects inconsistent resource and default ACL validators`; `an inherited policy's validator remains pinned even when its audience is unchanged`; `a captured inherited %s cannot be replaced while binding`; `undiscovered captured access cannot be replaced with fresh discovery`; `mergeContainer binds inherited copied grants to the same policy capture`. |
| Access-only completion ignores replacement bytes. A missing or weak PUT receipt also cannot establish success or authorize compensation against a later representation. | `src/apps/drive/lib/client/client.ts`: shared `guardedWrite` checks the PUT receipt after all post-write access/protection work and before disarming compensation. This covers standalone Upload/Replace/Keep both, direct writes, folder metadata, transfer payloads, and content replay. Raw empty provisioning stays under the provisioner's receipt/protection checks. Missing receipts preserve captured previous/new bytes privately without clearing unknown content; successful `write` returns the required receipt. `quarantine` marks private backups for retention on verification failure, preventing recursive compensation on uncertain verification failures and preserving their reported locations. Confirmed access changes still trigger conditional private evacuation; unavailable backups are excluded by read-only probes. | `drive-review-round62.test.ts`: `…reports a replaced PUT and retains recovery (404 hides Link: $hiddenLink)` (Upload, Replace, Keep both, standalone overwrite, owner-only overwrite); `…retains captured bytes without adopting a $receipt PUT receipt` (Upload/Replace × missing/weak). The round 61 `committed recovery removal reports a preservation failure after backup` also verifies the private-backup failure path. |
| Shape (a): a later read replaces an approved validator. | `src/apps/drive/components/protection-banner.tsx`: Delete uses the displayed file/folder ETag. For unversioned listings it captures metadata before enabling the button, then retains that capture. It rejects missing/weak validators and asks the user to refresh and confirm again on conflict. A read-only probe can resolve a banner after an already-absent item refuses its DELETE precondition. `src/apps/drive/lib/model/root.ts`: marker and Type Index writes use the captured version through refusal; no automatic write retry adopts another client's validator. A read-only check may accept another caller's completed initialization/registration. Explicit resumption or a new initialization call supplies a new decision. | `drive-review-round62-ui.test.ts`: `protection Delete keeps the displayed %s validator` and `protection Delete refuses an unconfirmed validator %s`, and `protection Delete hydrates an unversioned listing before confirmation and keeps that capture`; `drive/root.test.ts`: `root %s never adopts a later validator` for Type Index, container marker, description marker. |
| Shape (b): non-HTTP work between the final identity check and mutation. | `src/apps/drive/lib/model/root.ts`: all three initialization write paths use `commitRoot` → existing `commitHttp`, receiving serialized request data and captured policy guards before the boundary. The shared helper already owns raw final HTTP identity checks and synchronous commit/disarm effects; no helper API change was necessary. Other client/operation paths already use that boundary. | Both 40-step tables in `drive-review-round54-boundaries.test.ts`, relabelled for round 62; protection file/folder Delete tables in `drive-review-round62-ui.test.ts`; root Type Index/container-marker/description-marker table in `drive/root.test.ts` (also records serialization). This gives 45 steps tested for both shapes. The round 57 selection/preflight matrix also runs. |
| Partial Restore must compare the archived original audience. | Existing `client.bindAccess`/`recoveryPolicy` comparison already uses the archived original policy. No source change was needed. | `drive-review-round62.test.ts`: `partial Restore compares the archived shared %s after refused Trash DELETE` for a shared file and a folder with a shared child. Both pass before and after this round. |
| Low: New document links to an absent route. | `src/apps/drive/components/sidebar.tsx`: disabled menu item, without an anchor or navigation handler. | `drive-review-round62-ui.test.ts`: `New document stays disabled without a nonexistent route`, including pointer and keyboard activation. |

Additional changed test paths: `test/drive-client.test.ts` rejects a write without
a PUT receipt instead of expecting success; `test/drive-safety.test.ts` accepts
the earlier missing-copy refusal while still asserting that the source survives;
`test/drive-review-round50.test.ts` expects reported private recovery when a missing receipt prevents rollback; `test/drive-mergegate-round15-ui.test.ts` waits for pre-confirmation metadata hydration; `test/drive-review-round20-ui.test.ts` keeps its observable upload/focus assertions with a five-second polling budget for coverage runs; `test/drive/root.test.ts` provides validators on fixture HEAD responses and verifies
conflict refusal, concurrent completion observation, and explicit resumption rather
than automatic rebasing. New test files carry the required authorship marker.

## Every audited call site

| Path under `src/apps/drive/` | Audited call sites |
| --- | --- |
| `lib/client/commit.ts` | `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`, `Compensation.arm/disarm/rollback`; final checks use pre-hydrated identities and request inputs. |
| `lib/client/access.ts` | `discover`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured-source validation, creation acceptance, `identities`, `destinationOwn`, `destinationPolicy`, `installed`, `recheck`, `retire`, `rollback`; projection/materialization/retargeting/intersection. |
| `lib/client/client.ts` | `captureResource`, `checkContainerVersion`, `requireOwnReceipt`, `captureOwnAccess`, `createdOwnAccess`, `stat`, `readVersion`, `readRdf`, file/folder `snapshot`, `capturedAccess`, `verifySnapshotIdentity`, transfer destination capture, `verifyDestination`. |
| `lib/client/client.ts` | `guardedWrite` and both compensation branches (including missing receipts); `write`, `rawPut`, `replayProtected`, `replayOrQuarantine`, `quarantine` and private-backup retention, `createFolder`, `prepareTrash`. |
| `lib/client/client.ts` | `deleteVersion`, `deleteSnapshot`, `remove`; `copySnapshot`, `transfer`, `copy`, `move`, `rollback`, `secureRetained`; post-retirement survivor verification/private preservation; `mergeContainer`, metadata compensation, `verifyMerge`; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, `bindDestination`, public `bindAccess`, `exclusive`, public write/copy/move/remove wrappers; scope rechecks/retirement/compensation selection. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`. |
| `lib/client/container-versions.ts` | `track`, `prepare`, `current`, `identity`, `committed`: only atomic receipts of Drive's own mutations advance captured parent versions. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; intent persistence before final HTTP checks and compensation disarm before retirement persistence. |
| `lib/client/cleanup.ts` | `discardVersion`, `ownsEmptyContainer`; refusal probes cannot authorize a replacement validator. |
| `lib/client/protection-ledger.ts`, `source-operations.ts` | Durable protection/deletion reads/writes/clears and retirement; `sourceOperation`, lock acquisition/release. Hydration and locking precede final checks. |
| `lib/operations/operations.ts` | `uploadFile` (fail/Replace/Keep both), `renameItem`, `moveItems`, `copyItem`, `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `markRecovery`, `reconcilePending`, `listTrash`, `trashItems`, `trashItemsUnlocked`, `runTrash`, `requireTrashEntry`, `removeCompletedRecords`. |
| `lib/operations/operations.ts` | `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`, `restoreMissing` (folder merge, duplicate file/folder removal, unsettled Copy, Move), `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`/Empty Trash. Survivor checks use captured identities and archived original sharing. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, `readRoot`, `rootIdentity`, `validateRoot`, `initialize`, `register`, `resume`; conditional root creation, both marker targets, Type Index overwrite, read-only concurrent completion checks. |
| `state/ui.tsx` | `openDialog`, `refreshAfter`, rename/move/copy/Trash/Restore/Delete forever/Empty Trash/source-delete actions, Undo callback, `reportFailure`, `errorMessage`, `recoveryLocations`; existing confirmed validators remain in action/dialog state. |
| `state/undo.ts`, `state/uploads.ts` | `moveWithValidator`, tree verification and conditional fetch wrapper; upload conflict capture, `pump`, `resolve`, retry, `describe`. Undo uses its original move receipt; Replace uses its conflict decision's validator. |
| `state/resource.ts`, components | `useLiveResource`, `useResourceVersion`, `withHydratedMetadata`; `file-browser.tsx` selection/commands/preview reconciliation, `dialogs.tsx` rename/move/source-delete/Trash-delete snapshots, `views.tsx` Delete forever/Empty Trash entry snapshots, `preview.tsx` loaded-file validator, `upload-dock.tsx` errors, `protection-banner.tsx` Retry/Delete, `sidebar.tsx` New menu. |

The 40-step shared matrix covers Trash index overwrite; Move; Rename; Trash;
remove; recursive remove; Delete forever; Empty Trash; overwrite; folder metadata;
Restore; partial file/folder Restore; Copy payload; ACL overwrite;
replacement/Copy/container rollback; metadata undo; policy archive/receipt/slot/
ancestor cleanup; owner-only ACL/file/folder overwrite; private-folder ACL;
protection repair; retained/replay recovery clearing; container merge; partial
folder Restore metadata; file/container rollback without Link; folder-overwrite/
partial-Restore rollback with independent child defaults; inherited replacement
rollback; container-provisioning ACL; metadata-undo recovery clearing;
post-retirement private-backup ACL creation. Protection Delete and root writes
extend coverage outside the original client/operations matrix.

Concurrent changes between separate Solid requests remain possible. Drive stops
on observed identity/access changes, retains available recovery, surfaces the
failure, and never adopts a foreign validator to revert ACLs or content.

## Complete changed-path list

```text
src/apps/drive/components/protection-banner.tsx
src/apps/drive/components/sidebar.tsx
src/apps/drive/lib/client/README.md
src/apps/drive/lib/client/access.ts
src/apps/drive/lib/client/client.ts
src/apps/drive/lib/model/root.ts
test/drive-client.test.ts
test/drive-mergegate-round15-ui.test.ts
test/drive-review-round20-ui.test.ts
test/drive-review-round50.test.ts
test/drive-review-round54-boundaries.test.ts
test/drive-review-round62-audit.md
test/drive-review-round62-ui.test.ts
test/drive-review-round62.test.ts
test/drive-safety.test.ts
test/drive/root.test.ts
```

## Reproduction and validation

The current round's regressions were run against original `HEAD` source in
`/tmp/drive62-before`, without replacing working-tree source: **54 failed, six
passed** (93 unrelated root tests skipped). The passing cases are the two already
safe Copy validator variants, the two protection-Delete ordering variants, and
the shared file/folder partial Restore cases. Both original reported medium
classes and the low navigation finding fail before their fixes; additional root
and protection-Delete validator failures were reproduced before editing those
sources. The new regressions include 60 cases. Targeted checks also pass the existing
root initialization and both client/operations boundary matrices, plus historical
private-backup and protection-banner integration tests.

Final validation from `apps/suite`, with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage` with four workers and additional JSON reporters:
  **270 files, 12,654 tests passed**, exit 0. All **481 configured source files**
  individually have **100% statements, branches, functions, and lines**. Coverage
  globs and thresholds are unchanged. Full results are in
  `/tmp/drive62-final.json`; coverage is in `/tmp/drive62-final-coverage/`.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed. All 16 changed paths are under `apps/suite/`.
- Playwright was skipped as requested because localhost ports cannot be bound.

The full coverage run exposed an existing one-second upload-focus polling timeout
under instrumentation. Its observable completion, row, and focus assertions remain;
the polling budget is now five seconds. Three obsolete fallback branches were
removed after receipt and captured-policy invariants made them unreachable; no
coverage exclusions or threshold changes were used.

Changes remain uncommitted on `claude/DRV-04`.
