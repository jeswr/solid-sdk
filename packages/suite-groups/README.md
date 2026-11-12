<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Groups and family

`GroupDirectory({ storage, fetch, webId })` manages shareable groups on WAC Solid pods.
It reuses `ContactGroup` from solid-task-model without extending its domain model.
Group documents are `<storage>/groups/<uuid>.ttl#this`, typed `vcard:Group`, with
`vcard:hasMember` pointing directly to WebIDs. Private Contacts labels remain under Contacts.

**Privacy:** group names and member WebIDs are publicly readable, including anonymously,
so a Solid server can dereference an `acl:agentGroup` while authorizing another request.
The dedicated groups container has owner management and public Read on itself and descendants.
It never grants the public Write. Family identity, space URLs and delivery receipts live in an
owner-only `settings/group-sharing/state.json`. No profile or contact labels are made public.
ACP, LWS and unknown access models are explicitly unsupported; no individual-grant fallback.

Create/list/rename/addMember/removeMember/setFamily use conditional storage writes; conflicting
edits are surfaced for reload. Removing a member changes every symbolic WAC group grant when
the server next resolves membership (server caching may delay this). Individual grants and
previously downloaded copies remain unaffected.

`grants(id)` scans the owner's pod, with a 2,000-resource budget, and returns a deletion review.
Unreadable/unsupported resources or incomplete listings block deletion. `delete(review)` rescans,
refuses a changed resource set, removes grants via pod-access, then conditionally deletes the
group. Remote pods cannot be inventoried; deleting the document prevents resolving those groups.
Multiple-document operations are not atomic; a failure may leave some grants removed. Reload
and review before retrying. A concurrent grant written after the final scan cannot be locked
across HTTP resources; deleting membership still denies subsequent group resolution.

`share` writes a symbolic group grant through pod-access/roles and attempts member notifications.
It grants only Viewer or Editor, and refuses (`GROUP_TARGET`) the storage root, `settings/`,
`groups/`, anything under them, and access documents, using pod-access `isGrantableTarget`.
Pass the backing resource URLs together for a multi-resource item: all grants are written before
one notification attempt per member, using the first URL as the shared item's identity.
`setupFamily` marks the one Family group, calls injected application space factories, records
returned URLs privately for resumption, grants the selected Viewer/Editor role, then invites members.
Space factories must use their application's existing model and discovery path, and create a
fresh space rather than adopt an existing one. Factory and stored space URLs get the same target
check as `share` before they are stored or granted. Creation failures
are explicit and never imply all spaces were created. A crash between creating a space and storing
its URLs may require the owner to review that space before retrying.

Invitations and share notifications are inbox `Announce` activities. A per-member/per-target receipt
is persisted **before** delivery: retries/reopening never send a duplicate. This is one delivery
attempt, not guaranteed delivery; a crash after claiming, or a failed inbox, is reported/left unsent.
The owner is excluded. Permissions survive delivery failures. Receipts are pruned when a member is
removed (re-adding them invites them again) or the group is deleted, and capped at the newest
`NOTICE_LIMIT` (2,000); a pruned receipt's retry can send again. Settings ETag conflicts prevent a
second tab from posting the same claimed notification.

Legacy people dialogs can use `peopleWac` for their people projection while a separate group
section displays group access. Their replacement writes use `preserveGroupWac` to retain only
the original group selectors, scopes and metadata, splitting co-agents out. Subject collisions
refuse the replacement. These helpers do not grant access or change the original dataset.

`ownerOnlyAccess` verifies the nearest existing ancestor's raw WAC modes (pod-access
`readAccessModes`) before creating a Family space or registering its private index: for a
container both its own scope and the scope its members inherit. Every principal holding any mode
must be the owner, who must hold Read, Write and Control; Append-only or Write-only principals,
which map to no role, are refused. Unknown or unreadable policy is an error, with no permission
changes.

`wacGroupIds` retains group identities in access summaries so resources shared through a group
are never labelled "Only you". Person-only legacy ACLs keep their existing dialect handling.

Before making the dedicated container public, provisioning refuses any nonempty container whose
existing policy is private or permits other writers. It never publishes pre-existing private
contact labels. Listing, membership edits, Family marking and sharing verify, on raw modes, that
the groups folder (both scopes) and each group document have public Read, owner management and
no principal other than the owner holding anything but Read (so no Append, Write or Control);
private or writable group membership fails closed before grants are issued.
Trust in a dedicated folder (`groups/`, `settings/group-sharing/`) rests on a seal, not on its
current access alone (pod-access `sealAccess`, in the folder's own ACL, so only Control can write
it). Securing a folder rewrites its ACL to owner management (plus public Read for `groups/`),
deletes only what appeared during that rewrite, and seals it LAST. Readers (`list`, settings,
membership edits, Family marking, sharing) trust a folder only while it is sealed and still safe
on raw modes, and a document in it only while it inherits that folder's ACL (`governedBy`): an own
document ACL could have been planted, and sealed, by whoever wrote it before the folder was
secured. So a cleanup that fails part-way, a crash or a closed tab leaves the folder unsealed and
refused, and nothing it holds is trusted until the owner decides.

- A sealed, safe folder is left as it is. A sealed folder whose access widened is unsealed
  first, and then treated like any unsafe folder.
- An unsafe folder must be empty to be secured (`SETTINGS_UNSAFE`/`GROUP_UNSAFE` otherwise): its
  content could be someone else's, and is never taken over.
- A safe but unsealed folder that already holds documents a reader would read (`state.json`;
  group `.ttl` documents) is refused with `SETTINGS_UNVERIFIED`/`GROUPS_UNVERIFIED`, and nothing is
  deleted. It got that way through an earlier build, an ACL editor that dropped the seal, a
  cleanup that never finished, or a widen-then-narrow (the recovery `GROUP_UNSAFE` asks for).
  Deleting automatically would silently drop every group, and with it every `acl:agentGroup`
  grant, or re-send invitations. `unverified()` lists such folders and their documents, with a
  preview of what each says (`contents`, at most `PREVIEW_LIMIT` = 500): a group's name and member
  WebIDs, or the settings' Family group and the space URLs they would grant it, read with the
  readers' own parsers but trusted for nothing else and with no side effects. A document that
  can't be read or parsed is `unreadable`; `inherits` says whether it inherits the folder's ACL.
  `keepable` is true only when the folder is not `planted` (below) and every document is
  previewed, readable and inherits. `verifyFolder(folder, "keep")` re-checks that the folder is
  safe and not `planted` (`SECURING_INTERRUPTED`) and that every document inherits its ACL (one
  with its own ACL is refused, never kept) and is readable (`UNVERIFIED_UNREADABLE`), then seals
  without deleting; `verifyFolder(folder, "discard")` deletes what the folder holds, then seals.
  Settings → Groups & family lists the contents and warns that Keep trusts what anyone with
  earlier access could have written (and, for settings, that kept settings can grant the Family
  group the spaces listed). Remove comes first; Keep (offered only when `keepable`) and Remove
  each open a confirmation that takes focus, and Remove's says that removing groups ends every
  share made through them. Cancel returns focus to its button; the outcome is announced in a
  focused `role="status"` (or the error in a focused alert).
- Securing an unsafe folder marks it as being secured in the same ACL rewrite (pod-access
  `setGrants` `securing`, read with `isSecuring`), and the seal removes the mark. A folder that is
  safe, unsealed and still marked was left by a pass that stopped part-way (a failed delete, a
  crash), so everything it holds was planted: `unverified()` reports it as `planted`, Keep is
  refused, and the next provisioning pass deletes what it holds (readable documents first, past
  failures), seals it and fails with `SECURING_RACE` (reload and retry), as does "discard". Only
  the owner's own mark on the folder's own ACL counts, and a sealed folder ignores it, so forcing
  that deletion needs Control on the folder: the same threat level as forging the seal (below).
- Only documents that appear between the emptiness check and the permission rewrite (this pass's
  race window) are deleted automatically: the documents readers read first, each delete
  conditional on the entry's current ETag. A failure never stops the rest, and the call fails
  with `SECURING_RACE` (reload and retry) once the folder is sealed. Older never-read leftovers
  are left in place.
- Before deleting anything, the pass re-checks the seal. If another pass (another tab) has sealed
  the folder since this one rewrote it, it deletes nothing and re-checks the folder instead: that
  pass verified the folder before sealing it and creates groups only after its seal, while this
  pass listed what it would delete before the check, so a group the other tab just created
  survives.
- The seal is withheld (`SECURING_BLOCKED`) while a readable document survives, e.g. one whose own
  ACL shuts the owner out; remove it to continue. Other leftovers (such an undeletable `0.txt`, a
  planted sub-folder) are never read, so they do not block the seal.

Threat model limits of the seal:

- Anyone who held Control on the folder itself before it was secured could write the owner's
  seal into the folder ACL and then drop their own access: the result is indistinguishable from
  a folder the owner verified. Seals cannot prevent this; only grant Control on these folders to
  agents you trust.
- A planted document with its own ACL that lets the owner read it but not write or delete it
  blocks sealing permanently (`SECURING_BLOCKED`, and `verifyFolder` fails the same way). This
  fails safe, but recovering needs the server's administrator.
- If the owner widens a sealed folder's ACL with another tool and narrows it again before this
  library sees it, the seal survives (as for the requests-solid records folder).

A folder whose policy pod-access cannot represent as roles (e.g. Append-only grants) is refused
rather than rewritten.

`extend(source, resources, { within })` lets a collection's contents follow it: every shareable
group with access to `source` (e.g. the Family album) gets Viewer access to `resources` (e.g. an
added photo's document, original and thumbnail), with the same target checks as `share` and no
notification. `within` is the application folder (e.g. the Photos library); the source and every
resource must be canonical URLs strictly inside it. Callers pass only the resources the OWNER
added in this action, never members read back from a collection others can edit.
