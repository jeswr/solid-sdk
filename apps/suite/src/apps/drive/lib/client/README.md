<!-- AUTHORED-BY Codex -->

Drive binds destructive requests to the resource or policy validator approved at
selection/preflight, or to a receipt of its own successful conditional write.
`commitHttp` hydrates request data and runs access checks before its final raw
HTTP identity checks. No ledger read, Web Lock, serialization, or other asynchronous
work intervenes between those checks and the request. A committed destructive
step disarms its compensation before further bookkeeping.

Trash index writes also retain their initial validator through refusal. Conflicts
surface as persistence warnings rather than silently rebasing the same write.

A child PUT or DELETE can change a container's membership validator. Standard LDP
provides no atomic receipt for that parent change. Drive never adopts a later
HEAD/GET validator to explain it: it retains the approved validator and stops on
conflict, keeping recovery for a refreshed confirmation. This can leave a copied
tree or an empty recovery parent for the user to confirm again. Servers may supply
`X-Solid-Drive-Parent-Validators`, a JSON object mapping parent URLs to strong ETags,
**captured atomically by the mutating request**. The in-memory demo pod implements
this optional extension; generic Solid servers are not assumed to support it.

Concurrent ACLs are preserved. Installation expects the previously captured own
ACL, including absence. Compensation cannot adopt a concurrent policy's ETag or
rewrite it. If confidential bytes cannot be secured at their recorded ACL endpoint,
Drive saves private recovery copies before conditionally clearing only its own
exposed PUT. Failures report retained recovery locations. Another client can still
change content or access between requests: conditional mutations and operation
rechecks surface that limitation instead of attempting to revert the other client.

Round 56 audited call sites (all go through the same conditional HTTP boundary):

| Path | Call sites |
| --- | --- |
| `client.ts` | `stat`, `snapshot`, `captureResource`, `checkContainerVersion`, `verifySnapshotIdentity`, `verifyDestination`, `bindDestination`, `preparePolicies`, `recoveryPolicy`; `guardedWrite`, `write`, `rawPut`, `replayProtected`, `quarantine`; `copySnapshot`, `transfer`, `copy`, `move`, `rollback`, `secureRetained`; `deleteVersion`, `deleteSnapshot`, `remove`; `mergeContainer` and its metadata compensation; `prepareTrash`, `bindAccess` |
| `access.ts` | `store`, `install`, `privateFolder`, `checkOwn`, `bindAccess.recheck` and `rollback` |
| `ancestors.ts` | `create`, `resource`, `guard`, `check`, `verify`, `protect`, `install`, `cleanup` |
| `commit.ts` | `commitHttp`, `commitIrreversible`, `checkIdentity`, compensation arm/disarm/rollback |
| `container-versions.ts` | `track`, `prepare`, `committed`, `current`, `identity` |
| `deletion.ts` / `cleanup.ts` | `deletionControl.remove`, confirmation/retirement, `discardVersion` |
| `operations.ts` | `uploadFile`, `renameItem`, `moveItems`, `copyItem`, `trashItemsUnlocked`, `restoreMissing`, `restoreItemsUnlocked`, `deleteForeverUnlocked`, `removeTrashItem`, `purgeExpired`, `requireTrashEntry`, `removeCompletedRecords`, `updateIndexUnlocked`, `removePolicyArchive`, `removeRecoveryMarker`, `removeEmptySlot` |
| Media | `state/resource.ts`: `useLiveResource`, `useResourceVersion`; `components/preview.tsx`: `useLoadedFile` |
| Demo transport | `src/lib/demo-pod/pod.ts`: atomic `parentValidators` receipts on PUT/DELETE, before notifications |
| UI | Selection/dialog/confirmation snapshots and refresh wrappers in `state/ui.tsx`; reverse move and tree guards in `state/undo.ts`; Delete forever and Empty Trash entry snapshots in `components/views.tsx` |

Regression matrices in `drive-review-round54-boundaries.test.ts` exercise both
validator replacement and IndexedDB/Web Lock ordering for every destructive step,
including private retention's conditional payload clearing. The round 56 tests also
exercise missing atomic receipts on recursive removal, Move, Restore, partial
Restore, Delete forever, and Empty Trash.
