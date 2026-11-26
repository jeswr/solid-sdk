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

Images under the owner's `notes/media/` referenced by the note are listed in the
Share dialog. Saving sharing changes grants read-only access to only those listed
images; opening the dialog and ordinary note saves never grant collaborator or
public image access. Images added later need the owner to open Share again and
save sharing changes or choose Share listed images for the existing audience.
Images can appear in several notes. Grants are additive, but removing a collaborator,
lowering a role or restricting general access also narrows access to the listed images.
These revocations save the note first and continue across image failures, reporting
images that could not be updated. An unreadable image policy never blocks opening
Share or revoking note access. It disables granting controls until all listed image
policies can be verified; additions, role upgrades and opening general access fail closed.
Other images, including Docs assets, are not granted access by Notes sharing.

Labels and reminders remain in the note's RDF. On a shared note, collaborators
can see and edit its labels and reminders. Pin and colour remain local preferences.
All note fields use the note's original ETag in a single conditional write.

Opening Share still conditionally creates an owner-only ACL, even if the dialog is
cancelled. Archive, unarchive, Trash, restore and permanent deletion remove that ACL
with its ETag only after verifying owner-only grants and private inherited access;
shared or unknown access and failed conditional deletion still block the operation.

Batch archive/Trash actions, Keep import, empty Trash and automatic Trash expiry
check each note separately. Other notes continue, and refused notes are reported
individually with Share actions. An imported note that cannot be archived stays in
Notes, keeping its pin and colour at that address.

Shared links follow Sheets' origin boundary: a canonical note URL on another pod
on the current storage's origin opens through anonymous, redirect-refusing reads.
The view never acquires a writer or consumes another account's pending drafts.
Public notes work without credentials. Private foreign notes explain that access
from the owner's pod is needed and that opening private notes shared from another
pod is not supported yet (sst-imb.57.1). Cross-origin, auxiliary and ambiguous URLs
are refused with an explanation for foreign links. Owned notes use the existing
Notes scope rules, including extensionless note URLs.

An explicit `WAC-Allow` without Write opens an own-pod note as View only. A 403 on
autosave switches the mounted editor to View only and stops debounce, reconnect,
reopen and teardown saves. Local drafts remain durable and available through Copy
local changes and Download local changes. An explicit restored Write hint unlocks
the pending draft. Missing permission hints allow editing until storage responds.

Cards show Shared only when a readable own ACL confirms non-owner or public access.
Discovery never creates ACLs, never blocks the list, caps concurrent reads at four,
and leaves missing, inherited, unsupported and unreadable policies unmarked.

Search at `/notes/search` combines text with type (`images`, `lists`, `reminders`,
`links`), local colour, exact label and collaborator filters. The URL stores these as
`q`, `type`, `colour`, `label` and `shared`; `shared=any` includes every confirmed shared
note, including public links. Specific collaborator WebIDs come from the same read-only
discovery as the Shared indicator. Unknown sharing stays out of these filters.
Archived notes are searchable; Trash is excluded. Images use the approved image projection,
lists require checklist items, and links match HTTP(S) destinations or plain text URLs.
Start with the entry tiles or use Add filters while searching. Each chip removes one field;
Clear all also clears the text query. Filter links support bookmarks and browser history.

Version history (NOT-13) is in the editor's More note actions menu. It uses the
same history panel as Docs and previews an independent read-only editor with the
Notes schema, link rules and image boundary. Trashed notes cannot open history;
view-only collaborators can browse but cannot restore.

A confirmed restore flushes pending drafts, then saves the selected title and body
through the normal conditional draft writer. It preserves labels and reminders.
The same PUT records a named “Before restore” revision, including edits made inside
the ten-minute automatic snapshot interval. Histories retain at most twenty entries.
Conflicts, permission failures and retries use the normal editor recovery controls;
restore intent survives draft recovery so a retried restore also preserves the
replaced content. New revision snapshots store titles. Older revisions that have no
title keep the current note title when restored.

Restore never sends mention notifications: chips that come back with an old revision were
not typed by the person restoring it, so the save skips the mention pass. A revision title
over 200 characters is not restored; the current title is kept.

The editor's single More note actions menu holds Version history, Copy to Docs and Move to
Docs (trashed and view-only notes keep a menu with only Version history).

Copy and Move to Docs check the destination with `@jeswr/pod-access` before writing anything:
the Docs folder and the new document's assets folder must verify as owner-only. A private note
is refused (with a message, nothing written, no ACL changed) when Docs is shared, public or
cannot be verified; only a note proven already shared may go to a looser Docs. Source images
are read through a 20 MB streaming cap. In the demo pod, which has no storage description,
the check cannot be established and the copy is refused.

Clean up unused images never offers an image that is referenced by an unsaved draft in any
tab or by the in-memory drafts, changed in the last 24 hours, or without a usable
Last-Modified; drafts and age are checked again immediately before each delete. Docs version
snapshots, update logs and the Drive trash (`.trash/`) are searched by file name, and any
location that cannot be listed, read or bounded stops the scan with a message. A missing
`notes/` folder next to existing media is a fault. A malformed `img src` protects an image
it names instead of blocking, and an unreadable file in a notes folder is named in the error.
Not covered: notes moved by Drive elsewhere in the pod, and offline outbox copies.
