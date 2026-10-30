<!-- AUTHORED-BY Codex -->
# Drive review round 68

Paths below are relative to `apps/suite`. Changes stay in this application. No
commits, dependencies, shared packages, fonts, network requests or localhost
listeners were added. Playwright is excluded as requested.

## Finding, class, and changed paths

**Medium: confidential payload creation before own-ACL discovery.** An absent
resource's 404 without Link cannot establish its own ACL's absence. Parent
inheritance is provisional planning information until an empty resource makes
discovery possible. `src/apps/drive/lib/client/client.ts`, `guardedWrite`, now
routes standalone WAC creations through the existing `provision.file` flight.
The first PUT is empty and conditional on absence. The payload uses If-Match
with that PUT's strong receipt, retaining its captured discovery and policy.
An unexpected existing ACL stops the operation without sending payload bytes,
rewriting the policy, or deleting its associated resource. When a 404 already
exposes that ACL, `ancestors.create` refuses it before creation rather than
adopting it as a new item's policy. Both discovery shapes use the shared
provisioner. `rawPut` accepts only an empty literal body in TypeScript, enforcing
the empty-creation invariant at all four raw provisioning callers. Missing/weak
receipts never become permission to adopt a later validator.

The shared path covers Upload, Keep both, unconditional creation, recovery
backups, and guarded metadata/index creation. Copy, Move, Rename, Restore and
owner-only creation already use the same provisioner; their empty-placeholder
ordering remains covered. Existing overwrites keep the supplied If-Match.
Explicit no-ACL demo fixtures retain their direct conditional creation behavior.

**Archive hydration inside its own provisioning flight.** The new index-creation
path exposed an archive read waiting on the index's own unfinished flight.
`src/apps/drive/lib/client/ancestors.ts`, `resource`, now hydrates historical
policies before publishing its flight, for both inheritance and archived-folder
decisions. It keeps that capture during provisioning. Scoped access checks also
run before and after the new empty placeholder, so an unrelated source-policy
change stops bytes and allows only conditional cleanup of the empty receipt.

The changed documentation path is `src/apps/drive/lib/client/README.md`.

**Creation receipt hydration after guard collection.** With missing 404 Link,
standalone uploads and quarantine's backup bindings could accept a new endpoint
during `recheck`, after callers had already collected the final policy guards.
`src/apps/drive/lib/client/access.ts`, `bindAccess.identities`, now accepts the
pre-hydrated conditional creation receipt synchronously before returning guards.
Every consumer receives the new own-ACL absence assertion, including uploads,
private backups, clearing, provisioning and transfer scopes. This fixes the
shared preparation order without adding an asynchronous gap or a separate final
check algorithm. A concurrent ACL creation now refuses the payload/clear at the
existing shared boundary; foreign policies and recovery copies remain intact.

## Regression tests

`test/drive-review-round68.test.ts` adds:

- `round 68: $step discovers an orphan own ACL before sending confidential bytes (404 hides Link: $hiddenLink)`:
  Upload, Keep both, unconditional creation; real WAC resolution, private parent,
  pre-existing public own ACL, with and without Link on 404, anonymous exposure
  audit after every request. Missing discovery permits only one empty PUT;
  already-known own ACLs refuse before any PUT. Foreign policy remains intact.
- `round 68: %s verifies an empty placeholder before its conditional payload PUT`:
  Upload, Keep both, unconditional/owner-only creation, Copy, Move, Rename,
  Restore; payload If-Match equals the original empty PUT receipt.
- `round 68: a new upload retains the legacy archived file policy installed on
  its placeholder`: originally private archived file under recreated public
  inheritance stays private, including at intermediate requests.
- `round 68: a placeholder receipt of %s cannot be replaced by a later validator`:
  missing and weak receipts stop before the payload.
- `round 68: a scoped source change during placeholder creation stops bytes and
  conditionally removes the empty receipt`: preserves the changed source policy.
- `round 68: guarded creation hydrates a Trash index archive before publishing
  its own placeholder flight`: index creation completes with verified privacy.
- `round 68: %s hydrates creation receipts before collecting final own-ACL absence guards`:
  Upload and recovery clearing; introduce an ACL at the first final conditional
  HEAD after the access rechecks. Upload sends no confidential bytes; clearing
  keeps both recovery copies and the original payload instead of trusting an
  unchecked backup ACL. Neither path rewrites the foreign ACL.
- `round 68: $step preserves an orphan ACL without publishing bytes or children (404 hides Link: $hiddenLink)`:
  Copy, Move, Rename, Restore, owner-only creation, New folder, folder Copy and
  folder Move, each with both discovery shapes; preserve the source/recovery and
  foreign ACL, with no payload/children, ACL rewrite or target DELETE.
- `round 68: shared %s partial Restore compares archived grants after refused
  Trash DELETE`: file and folder; shared original remains unchanged, recovery is
  owner-only, and duplicate recovery can be retired. The archived-original
  comparison in `client.bindAccess`/`mergeContainer` remains intact.

The final round-68 tests and the three new matrix variants were replayed against
original HEAD source in `/tmp/drive68-before`, leaving the workspace source
untouched: **25 failed, 24 passed**. The orphan-ACL reproductions, newly enforced
placeholder ordering, legacy policy case, missing/weak receipt cases, scoped
source case, creation-guard preparation cases, and both ordering shapes/final-discovery checks for all three new
payload variants fail before the fix. Known orphan ACLs on new folder creation
also failed before the shared invariant. The already-secured transfer/owner-only
paths, shared-original Restore cases and original direct index creation pass.

`round 68: placeholder provisioning never replaces an approved If-Match when
both preconditions were supplied` also closes the invalid dual-header case:
placeholder creation requires no existing If-Match. The approved validator stays
in the shared final check and the missing target refuses with 412, without a PUT.
This test failed against the intermediate placeholder implementation and passes
with the explicit invariant. It passes against original HEAD as well.

## Both ordering shapes and final discovery

`test/drive-review-round54-boundaries.test.ts` now enumerates **57 step variants**
in each of three tables:

- `round 68 shape a: %s retains a replacement at its final identity check`;
- `round 68 shape b: %s performs no local async work after the final HTTP identity check`;
- `round 68 final discovery: %s refuses an ACL endpoint change on its conditional HEAD`.

The new variants are Upload payload, Keep both payload and unconditional creation
payload. The replacement test also requires these cases to reach the conditional
payload request, preventing a post-creation completion check from passing as the
intended boundary. Shape (b) records IndexedDB and Web Lock events and requires
the last event before every destructive request to be its conditional HTTP HEAD.
The final-discovery table changes every captured identity at each boundary,
including policy, parent, source, survivor and target assertions.

The retained variants cover Trash index overwrite; Move/Rename/Trash/remove and
recursive removal; Delete forever/Empty Trash; file/folder overwrite; Restore and
partial file/folder Restore; Copy payload; ACL overwrite; replacement/upload/
folder/Copy/container rollback; metadata undo; policy archive/receipt/slot/
ancestor cleanup; owner-only ACL and file/folder overwrite; private folder ACL;
protection receipt repair; retained/replayed recovery clearing; container merge;
partial folder Restore metadata; rollback without Link; folder/partial Restore
rollback with independent child defaults; inherited replacement rollback;
container provisioning ACL; metadata-undo recovery clearing; private backup ACL;
Move/Rename/Trash/Restore/Delete forever/Empty Trash trees; Replace/Move/Copy
completion recovery clearing; shared partial file/folder Restore; and failed
verification/replay clearing.

## Compatibility assertions changed

These tests retain their original safety assertions and account for an empty
placeholder before the payload:

- `test/drive-mergegate-round16-ui.test.ts`, `test/drive-mergegate-round17-ui.test.ts`,
  `test/drive-mergegate-round18-ui.test.ts`: confirmation still precedes all
  writes; assert conditional creation followed by the exact placeholder ETag.
- `test/drive-review-round50.test.ts`, `test/drive-review-round59.test.ts`,
  `test/drive-review-round61.test.ts`, `test/drive-review-round62.test.ts`,
  `test/drive-review-round63.test.ts`: inject post-payload receipt/access/backup
  failures after nonempty bytes, preserving their rollback and recovery coverage.
- `test/drive-mergegate-round12.test.ts`,
  `test/drive-mergegate-round14.test.ts`: ancestor protection still blocks early
  writes. If concurrent creation/Restore changes a captured parent/policy between
  placeholder and payload, assert the surfaced refusal and retry as a fresh
  operation after settlement. Never refresh the running operation's validator.

## Every audited call site

All paths in this table are under `src/apps/drive/`. Read-only preflight and
ambiguous-delete settlement reads do not authorize mutations; final identities
continue through `checkIdentity` in the shared commit boundary. No new final
HEAD/GET algorithm was added.

| Path | Audited call sites |
| --- | --- |
| `lib/client/commit.ts` | `confirmationOptions`, `discoveryOptions`, `requireResourceAssertion`, `assertVersion`, `checkIdentity`, `commitHttp`, `commitIrreversible`; target, policy, additional resource and protected-resource assertions; compensation arm/disarm/rollback and synchronous commit effects. |
| `lib/client/client.ts` | `finalIdentity`, `checkResourceIdentity`, `captureResource`, `captureOwnAccess`, `createdOwnAccess`, `requireOwnReceipt`, `checkContainerVersion`, `capturedAccess`, `verifySnapshotIdentity`; `listing`, `stat`, `snapshot`, `readVersion`, `readRdf`. |
| `lib/client/client.ts` | `scopePolicyGuards`, `verifyScopeHeaders`, `retireScope`, `recheckScope`, `compensationsFor`; `guardedWrite` previous-version GET, new placeholder flight, final parent/target checks, payload and both compensation branches; `write` owner-only capture/protection/placeholder and folder metadata; all four empty-only `rawPut` callers: `guardedWrite`, owner-only `write`, `provision.putFolder`, and file `copySnapshot`. |
| `lib/client/client.ts` | `quarantine` folder/backup creation, survivor checks, conditional clear and completion; `replayProtected`, `replayOrQuarantine`; `createFolder`, `prepareTrash`; `deleteVersion`, `deleteSnapshot`, direct/recursive `remove`, survivor comparison and recovery retention after committed deletion. |
| `lib/client/client.ts` | `copySnapshot`, `transfer`, `copy`, `move`, destination capture/`verifyDestination`, `bindDestination`, `verifyAccess`, `rollback`, `secureRetained`; renewed Move consent, source deletion, destination completion, and Undo receipts. |
| `lib/client/client.ts` | `mergeContainer`, `verifyMerge`, metadata compensation; `bindRecoveryPolicy`, `recoveryPolicy`, `preparePolicies`, public `bindAccess`; `exclusive` and public write/copy/move/remove wrappers. Partial Restore compares archived original grants. |
| `lib/client/access.ts` | `discover`, `captureEndpoint`, `verifyEndpoint`, `read`, `snapshot`, `effective`, `checkOwn`, `ownAccessGuards`; conditional `store`, `install`, `privateFolder`; `bindAccess.resolve`, captured source, creation acceptance, identity guards, endpoint verification, installed receipt, recheck, retirement and rollback; grant projection/materialization/intersection/retargeting. Missing 404 Link remains provisional; it authorizes only an empty placeholder. The shared `identities` getter now hydrates creation receipts before any caller freezes its final guard batch. |
| `lib/client/ancestors.ts` | `singleFlight`, `requirementFor`, `policyFor`, `checkProtection`, `retireProtection`, `verify`, `install`, `cleanup`, `create`, `archived`, `guard`, `check`, `resource`, `folder`, `file`, `protect`; historical-policy hydration now precedes the resource flight. |
| `lib/client/deletion.ts` | `deletionControl.remove`, `guard`, `reread`, `retire`, `forget`, `recheck`, `classifyDelete`; intent persistence precedes final HTTP checks; committed deletion disarms compensation before ledger retirement. |
| `lib/client/container-versions.ts`, `cleanup.ts`, `protection-ledger.ts`, `source-operations.ts` | `track`, `prepare`, `identity`, `current`, `committed`; atomic parent receipts only; `discardVersion`, `ownsEmptyContainer`; protection/deletion ledger reads, writes, migration and retirement; operation reservations/Web Locks. |
| `lib/operations/operations.ts` | `uploadFile` fail/Replace/Keep both, `createFolder`, `renameItem`, `moveItems`, `copyItem`; `updateIndex`, `updateIndexUnlocked`, `sourceVersions`, `sameRecoveryFile`, `holdsRecovery`, `recoveryStatus`, `markRecovery`, `reconcilePending`, `recoveryItems`, `requireTrashEntry`, `listTrash`. |
| `lib/operations/operations.ts` | `trashItems`, `trashItemsUnlocked`, `runTrash`, `exclusiveBatch`, `removeCompletedRecords`; `capturePolicyArchive`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`; `restoreMissing` folder merge, duplicate file/folder removal, unsettled Copy, settled Move; `restoreItems`, `restoreItemsUnlocked`, `deleteForever`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`. |
| `lib/model/root.ts` | `ensureDriveRoot`, `createRoot`, `commitRoot`, root/description markers, Type Index registration and resumable initialization; creation is empty, later mutations are conditional through the shared helper. |
| `state/ui.tsx`, `state/undo.ts`, `state/uploads.ts` | Rename/Move/Copy/Trash/Restore/Delete forever/Empty Trash/source-delete confirmation snapshots, `refreshAfter`, `moveWithValidator` and tree guards, reverse-move receipts, `pump`, `resolve`, Retry and Replace renewal; errors surface discovery/precondition failures. |
| `state/resource.ts`, `components/dialogs.tsx`, `components/views.tsx`, `components/protection-banner.tsx` | Selection/dialog hydration before confirmation; `withHydratedMetadata`, `useLiveResource`, `useResourceVersion`; captured Delete forever/Empty Trash entry lists; protection Delete's captured ETag/discovery. |

Solid has no transactions. Concurrent content/access changes between requests
remain the agreed residual: stop on observed disagreement, preserve recovery,
surface the refusal, and never rewrite a foreign ACL/content or substitute a
fresh validator for the one already approved.

## Validation

Final requested checks from `apps/suite`, with `PATH=/opt/node24/bin:$PATH`:

- `npx vitest run --coverage`: **282 files, 12,972 tests passed**, exit 0.
  Each of the **481 configured source files** has **100% statements, branches,
  functions and lines**. The JSON summary has no file below any threshold;
  coverage configuration and thresholds are unchanged.
- `npx tsc --noEmit -p .`: passed, exit 0.
- `npx biome check src test`: passed, exit 0; 72 existing warnings, no errors.
- `git diff --check`: passed.

The focused final boundary/round-68/UI run passed all 218 cases. The receipt-guard
Upload and recovery-clearing cases both failed before the shared getter fix;
the dual-precondition case failed before its invariant. The original-HEAD replay
above independently records 25 failing regressions and 24 already-closed cases.

No commit, package/font change, external network access or localhost listener
was added. Playwright was skipped as requested. No build/font workaround was
needed or applied.
