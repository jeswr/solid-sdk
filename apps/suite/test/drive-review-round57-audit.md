<!-- AUTHORED-BY Codex -->

# Drive review round 57

Every reported finding was reproduced before its fix in `drive-review-round57.test.ts`
and `drive-review-round57-ui.test.ts`. The additional backup-ACL and compensation-receipt reproductions
in `drive-review-round57-boundaries.test.ts` also failed before the invariants were tightened.

| Finding / class | Shared fix and changed paths | Regression test name (prefix `round 57:`) |
| --- | --- | --- |
| Unrelated ACL grants activate after relocation | `client/access.ts`: materialize only source-applicable access/default grants, retarget only ACL targets and authorization identifiers, preserve principal/origin identities. `client/rdf.ts`: optional predicate restriction for relocated objects. `client/ancestors.ts`: use the same materialization for protection requirements, verification and concurrent ancestor checks. `client/client.ts`: use it for inherited copy policies and archived recovery policies. | `copy/rename materializes only the source's applicable ACL grants`; `file/folder ACL transfer preserves principal identities and ignores foreign defaults` |
| Restore adopts a replacement archive (shape a) | `operations/operations.ts`: bind the captured archive (including absence) before Restore/Delete forever. `client/client.ts`: scoped archive bytes and validators, shared across ordinary copy/move, container merge and partial Restore; archive validators join the final HTTP checks and retire on committed cleanup. | `complete/partial Restore pins its preflight policy archive` |
| Provisioning cleanup crosses persistence (shape b) | `client/commit.ts`: pre-hydrated policy identities, including absence, checked after every callback and persistence operation. `client/ancestors.ts`: carry the captured ACL receipt through deletion-ledger persistence. `client/client.ts`: same guard for file/folder rollback and upload cleanup. | `provisioning cleanup checks ACL ownership after pending.add` |
| Destination revocations ignored | `client/access.ts`: compare destination narrowing as well as widening; a destination revocation does not become an invitation to approve a new transfer. `client/client.ts`: carry scoped access receipts into payload and recursive deletion commits. | `copy/rename stops on an inherited destination revocation` |
| Quarantine clears the last surviving contents | `client/client.ts`: capture each backup PUT validator; hydrate ledger state first, then verify backup access and all backup identities before the conditional clear. Backup ACL identities are captured before writing and rechecked after ledger hydration. A definitely missing backup is excluded from retained locations. | `copy/move never clears its last original bytes when quarantine backup disappears`; `quarantine never adopts a backup ACL installed during ledger hydration` |
| ACL verification adopts a replacement receipt (shape a) | `client/access.ts`: require a strong ACL PUT receipt and exact validator equality on verification; compensation cannot adopt another writer's restricted or removed ACL. `test/drive-wac-pod.ts`: model ACL PUT receipts. | `ACL verification never adopts an equivalent replacement validator`; `ACL installation requires its own strong PUT receipt`; `compensation never adopts a concurrently restricted ACL as its own receipt` |
| Upload hides recovery locations | `state/uploads.ts`: preserve partial-failure retained URLs in the upload error displayed by the dock. | `failed replacement uploads show every private recovery location` |
| Partial Restore compares the private recovery policy | `client/client.ts`: bind comparison to the pinned original archive, shared with other recovery operations. | `partial Restore compares a shared original against archived own/inherited grants`; existing round-56 file/folder × own/inherited tests remain exercised |

`drive-review-round57-boundaries.test.ts` tables exercise shapes a and b for replacement
upload, ACL overwrite, source DELETE, move, rename, Trash, Restore, partial Restore,
recovery DELETE, Delete forever, Empty Trash, and container merge. The shape-b table logs
IndexedDB reads/writes/deletes as well as HTTP, and checks every destructive request in
the operation, including metadata and housekeeping. Dedicated failure-path tests cover
provisioning cleanup, ACL installation rollback, quarantine and upload compensation.

## Audited call sites

All paths below are relative to `apps/suite/src/apps/drive/`.

| Path | Audited call sites / invariant |
| --- | --- |
| `lib/client/commit.ts` | `commitHttp`, `commitIrreversible`, `checkIdentity`, `Compensation.rollback`: fully hydrated conditional requests, raw final HTTP checks, no local persistence after those checks, disarm on commit. |
| `lib/client/access.ts` | `store`, `install`, `privateFolder`, `bindAccess.recheck/installed/rollback`, `intersectAccess`, materialization and retargeting: conditional ACL creation/overwrite, exact receipt ownership, both endpoint policies. |
| `lib/client/ancestors.ts` | `create`, `cleanup`, `verify`, `install`, `guard`, `resource`, `protect`, archived ancestor lookup: captured resource/ACL ownership survives locks and ledger persistence. |
| `lib/client/client.ts` | `quarantine`, `guardedWrite`, `replayProtected`, `write`, `rawPut`, `createFolder`, `prepareTrash`: conditional payload/metadata writes, owner-only provisioning, backup survivors, compensation receipts. |
| `lib/client/client.ts` | `snapshot`, `deleteVersion`, `deleteSnapshot`, `copySnapshot`, `verifySnapshotIdentity`, `rollback`, `secureRetained`: source and destination identities, recursive ancestry, ACL-owning cleanup, private recovery. |
| `lib/client/client.ts` | `recoveryPolicy`, `preparePolicies`, `mergeContainer`, `transfer`, `copy`, `move`, `remove`, public `bindAccess/bindRecoveryPolicy/exclusive`: archive identity, partial recovery, source guards, scoped access, disarm after committed deletion. |
| `lib/client/deletion.ts` | `remove`, `guard`, `reread`, `retire`: hydrate request records before final HTTP checks; read-only reconciliation never supplies a replacement validator to DELETE. |
| `lib/client/cleanup.ts` | `discardVersion`: refusal never rebases a validator, including byte-identical replacements. |
| `lib/client/container-versions.ts` | `prepare`, `current`, `identity`, `committed`: only atomic mutation-response receipts advance captured container validators; fresh reads cannot authorize a replacement. |
| `lib/operations/operations.ts` | `uploadFile`, `renameItem`, `moveItems`, `copyItem`, `updateIndex`, `trashItems/runTrash`, `sourceVersions`: carry selected identities; metadata writes conditionally merge a captured RDF version. |
| `lib/operations/operations.ts` | `capturePolicyArchive/removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot`, `restoreMissing`, `restoreItems`, `deleteForever`, `removeTrashItem`, retention expiry: conditional captured versions, survivor checks, no validator refresh after refusal. Empty Trash calls Delete forever with its captured entries. |
| `state/ui.tsx` | `refreshAfter`, rename/copy/move/Trash/Restore/Delete forever actions and confirmation state: wrappers forward captured items and operation options unchanged. |
| `state/undo.ts` | `moveWithValidator`: original move receipt and descendant receipts remain pinned through Undo. |
| `state/uploads.ts` | conflict confirmation, `pump`, retry and `describe`: approved replacement remains pinned; retry requests a new choice and retained recovery URLs remain visible. |
| `components/views.tsx` | Trash selection and Empty Trash/Delete forever confirmations preserve the displayed entry objects and their validators. |

Two Solid requests cannot form a transaction. A concurrent change between final HTTP
checks and a conditional mutation remains possible; Drive's conditions and subsequent
access checks refuse or surface it. Compensation never overwrites a changed ACL/content
version. Standard LDP's missing atomic parent receipts remain a fail-closed limitation.

## Complete changed-path inventory

Implementation:

- `apps/suite/src/apps/drive/lib/client/access.ts`
- `apps/suite/src/apps/drive/lib/client/ancestors.ts`
- `apps/suite/src/apps/drive/lib/client/client.ts`
- `apps/suite/src/apps/drive/lib/client/commit.ts`
- `apps/suite/src/apps/drive/lib/client/rdf.ts`
- `apps/suite/src/apps/drive/lib/operations/operations.ts`
- `apps/suite/src/apps/drive/state/uploads.ts`

Tests, fixture, and audit record:

- `apps/suite/test/drive-review-round57.test.ts`
- `apps/suite/test/drive-review-round57-boundaries.test.ts`
- `apps/suite/test/drive-review-round57-ui.test.ts`
- `apps/suite/test/drive-wac-pod.ts`
- `apps/suite/test/drive-mergegate-round14.test.ts` (public method inventory)
- `apps/suite/test/drive-mergegate-round24.test.ts` (explicit DELETE synchronization)
- `apps/suite/test/drive-review-round49.test.ts` (changed policies refuse instead of rebasing)
- `apps/suite/test/drive-review-round55.test.ts` (foreign revocations remain untouched; intersection uses an explicitly captured policy)
- `apps/suite/test/drive-review-round56.test.ts` (a concurrent ACL removal is preserved; original bytes remain in private recovery)
- `apps/suite/test/drive-review-round57-audit.md`

## Validation

Executed from `apps/suite` with `PATH=/opt/node24/bin:$PATH`:

- Vitest with coverage: 261 files, 12,442 tests passed. All 481 configured coverage files have 100% statements, branches, functions, and lines.
- `npx tsc --noEmit -p .`: passed.
- `npx biome check src test`: passed with 72 existing warnings and no errors.
- `git diff --check`: passed.

Playwright was skipped as instructed. No dependencies were added, no network requests were made, and no commits were created.
