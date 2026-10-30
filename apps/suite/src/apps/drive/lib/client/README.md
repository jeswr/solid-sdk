<!-- AUTHORED-BY Codex -->

Drive binds destructive requests to the resource or policy validator approved at
selection/preflight, or to a receipt of its own successful conditional write.
WAC application origins are compared independently of principal grants, including
origin-only authorizations. Recovery intersection preserves only approved origins.
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
Every DELETE requires a synchronous endpoint assertion on its existing final
resource HEAD, alongside its captured content and policy validators. Normal
transfer deletion, duplicate recovery removal, recursive removal and purge share
the same mandatory boundary as rollback. Scoped Restore bindings retain their
original endpoints through this assertion. Explicit deletion on unsupported access
models pins the advertised endpoint without attempting to install a policy.
A disagreement preserves recovery and the concurrent ACL. Late transfer failures
keep Trash's private copy; other retained destinations become owner-only through
conditional writes to their captured ACLs, or use private evacuation if that fails.
Overwrite PUTs, metadata replay, container merging and root/index/description
writes assert their captured endpoint on the same final HTTP boundary. Transfer
preflight also requires a recovery owner before moving non-demo resources, so a
late revocation can always retain private copies even for children without Control.

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

All content identity HEADs use `checkResourceIdentity`, which requires a synchronous
captured-endpoint assertion. PUT completion reuses the same assertion as its commit
boundary, before disarming recovery. Move checks destination discovery both before
source DELETE and after retirement; Copy, source snapshots, metadata merge guards,
rollback source proofs, partial-Restore survivors and private backup completion
checks share the invariant. Policy-archive presence checks remain separate. A
matching content ETag never excuses an observed change in ACL discovery.

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

The [round 65 audit](../../../../../test/drive-review-round65-audit.md) lists every
audited call site, completion endpoint assertions and recovery, Details refresh
ownership, Move-tree focus, and the 51-step matrix for both ordering shapes.

The [round 64 audit](../../../../../test/drive-review-round64-audit.md) lists every
audited call site, the mandatory deletion endpoint invariant, Unix listing dates,
mobile Trash commands, and the expanded 48-step matrix for both ordering shapes.

The [round 63 audit](../../../../../test/drive-review-round63-audit.md) maps every
audited call site, the independent-origin and rollback-endpoint fixes, toast/modal
focus recovery, and the expanded 42-step mutation matrix for both ordering shapes.

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
