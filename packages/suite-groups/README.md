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
Pass the backing resource URLs together for a multi-resource item: all grants are written before
one notification attempt per member, using the first URL as the shared item's identity.
`setupFamily` marks the one Family group, calls injected application space factories, records
returned URLs privately for resumption, grants the selected Viewer/Editor role, then invites members.
Space factories must use their application's existing model and discovery path. Creation failures
are explicit and never imply all spaces were created. A crash between creating a space and storing
its URLs may require the owner to review that space before retrying.

Invitations and share notifications are inbox `Announce` activities. A per-member/per-target receipt
is persisted **before** delivery: retries/reopening never send a duplicate. This is one delivery
attempt, not guaranteed delivery; a crash after claiming, or a failed inbox, is reported/left unsent.
The owner is excluded. Permissions survive delivery failures. Settings ETag conflicts prevent a
second tab from posting the same claimed notification.

Legacy people dialogs can use `peopleWac` for their people projection while a separate group
section displays group access. Their replacement writes use `preserveGroupWac` to retain only
the original group selectors, scopes and metadata, splitting co-agents out. Subject collisions
refuse the replacement. These helpers do not grant access or change the original dataset.

`ownerOnlyAccess` verifies the nearest existing ancestor's WAC roles before creating a Family
space or registering its private index. It refuses foreign/public principals and requires owner
management; unknown or unreadable policy is an error, with no permission changes.

`wacGroupIds` retains group identities in access summaries so resources shared through a group
are never labelled "Only you". Person-only legacy ACLs keep their existing dialect handling.

Before making the dedicated container public, provisioning refuses any nonempty container whose
existing policy is private or permits other writers. It never publishes pre-existing private
contact labels. Listing, membership edits, Family marking and sharing verify that each group
document has public Read, owner management and no other writers; private or writable group
membership fails closed before grants are issued.
Existing settings documents must also have owner-only access before their Family space URLs or
notification receipts are trusted. An individual document ACL cannot bypass the private folder.
