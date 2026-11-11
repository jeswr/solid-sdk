<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Notes sharing (sst-imb.60, NOT-05 first slice) uses the shell share dialog from the
card's Collaborator menu and the editor's Collaborator button. It supports WebID
viewers, editors and public links. This slice adds access control and view-only
reading. Realtime co-editing and the Yjs update log are out of scope; Notes retains
its single-writer model with conditional ETag saves and conflict recovery.

The note document gets its own WAC policy. Missing ACLs are created conditionally
only after verifying owner-only inherited access, including both `acl:default`
and legacy `acl:defaultForNew`, or on the isolated demo pod. Existing inherited
collaborators must be managed at their source. ACP discovery, mixed-policy RDF,
unsupported policy shapes and changed ACL endpoints refuse sharing changes.
These checks live in the small shell `VerifiedWacSharingAdapter`, also used by Sheets.

Referenced `notes/media/` images receive read grants before the note grant is
written. Images can appear in several notes, so their existing grants are never
removed or downgraded. The dialog explains that removing a collaborator or
restricting the note leaves image grants in place. Newly attached images receive
the note's existing reader and public grants before saving the new body. A note
referencing Docs assets must move those images into Notes media before sharing.
No container-wide grant or preference ACL is changed.

Before opening sharing, labels and reminders move from the note's RDF into an
owner-only `settings/notes/<encoded-note-url>.ttl` resource. Its effective privacy
is verified before writing; unverified or shared inheritance refuses preparation.
The note links to that resource with `rdfs:seeAlso`, and subsequent reads and saves
keep owner fields there. Archive and Trash retain this separation. Pin and colour
remain the owner's existing local preferences. Preference writes and note writes
are separate conditional operations; recovery retains the pending note if either
fails. Private preference resources are retained when a note moves or is deleted.

Shared links follow Sheets' origin boundary: a canonical note URL on another pod
on the current storage's origin opens through anonymous, redirect-refusing reads.
The view never acquires a writer or consumes another account's pending drafts.
Public notes work without credentials. Private foreign notes explain that access
from the owner's pod is needed and that opening private notes shared from another
pod is not supported yet (sst-imb.57.1). Cross-origin, auxiliary and ambiguous URLs
are refused with an explanation.

An explicit `WAC-Allow` without Write opens an own-pod note as View only. A 403 on
autosave switches the mounted editor to View only and stops debounce, reconnect,
reopen and teardown saves. Local drafts remain durable and available through Copy
local changes and Download local changes. An explicit restored Write hint unlocks
the pending draft. Missing permission hints allow editing until storage responds.

Cards show Shared only when a readable own ACL confirms non-owner or public access.
Discovery never creates ACLs, never blocks the list, caps concurrent reads at four,
and leaves missing, inherited, unsupported and unreadable policies unmarked.
