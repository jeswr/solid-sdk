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

Compensation uses the complete captured own ACL, including independent child
defaults. An unchanged ACL stays intact during content replay; its captured
validator joins the final HTTP checks. A failed quarantine reports every backup
already saved, including backups retained by a nested failure, even when later
discovery, backup creation, receipt validation, or ledger hydration fails. Backup
PUT receipts are recorded before verification; uncertain locations are checked
only for error reporting, without authorizing any later mutation.

Captured absence stays absent during both file and folder metadata replay. If
access changed, both paths share private evacuation before conditionally clearing
Drive's PUT. Replay never installs an ACL, and protection requires the endpoint
and complete own-policy receipt to be hydrated by its caller. Overwrite backup
GETs must match the approved body validator before the write can proceed. ACL installation
pins the discovered endpoint even when its own
policy is absent; the existing final resource HEAD verifies that endpoint
synchronously as well as its ETag. Transfer checks surviving access after source
DELETE retirement, while partial-transfer recovery remains available. It also
checks every captured destination's content identity there. Copy verifies its PUT
receipts before success. Partial Restore hydrates recovery bytes before discarding
a duplicate and checks the compared survivors after retirement; a failed check
retains the captured bytes privately without clearing a recreated resource.

A missing Link on a 404 is undiscovered access, not a pinned absent endpoint. Only
a new conditional-creation receipt with a strong ETag can establish that endpoint;
a later HEAD cannot replace it. Provisioning, uploads, transfers, recovery backups,
and root initialization share this rule. Protection retirement verifies the saved
ACL, endpoint, and resource after clearing its ledger. Conditional ACL PUT receipts
are saved before subsequent verification reads. Pending protection pins the original
own policy or absence, so an unknown historical endpoint cannot authorize repair.
Failure keeps a durable
receipt for the actual installed policy, including narrower intersections, so Retry
cannot repair another client's replacement or revocation.

The [round 62 audit](../../../../../test/drive-review-round62-audit.md) maps copied
policy captures, PUT identity checks and recovery, protection Delete, root writes,
every audited call site, and the 45-step two-shape regression coverage.

The [round 61 audit](../../../../../test/drive-review-round61-audit.md) maps the
findings, changed paths, every audited call site, and both destructive-step matrices.

The [round 60 audit](../../../../../test/drive-review-round60-audit.md) lists every
audited caller and maps the findings to the 39-step two-shape regression matrix.

Round 59 audited call sites (all go through the same conditional HTTP boundary;
full finding/test mapping in the [round 59 audit](../../../../../test/drive-review-round59-audit.md)):

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
