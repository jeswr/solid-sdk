// AUTHORED-BY Codex GPT-6.1-Sol

Sheets uses `WorkbookService` for pod storage and a lazy Univer 1.2.0 adapter for the editor.
The demo session uses the same service against the browser's persistent demo pod.

The editor and list menu open the shell's sharing dialog for the workbook container.
WAC grants update both `acl:accessTo` and `acl:default`, covering metadata, the engine
snapshot, sheet projections and versions that inherit this policy. Existing member ACLs
remain authoritative. Sharing supports viewers, editors and public links; it adds no
realtime collaboration. Unsupported ACL shapes and ACP fail closed. A missing own ACL
is created conditionally only after verifying owner-only inherited access, or for the
isolated demo pod. Inherited policies with other collaborators must be managed at their source.
Verification includes both `acl:default` and legacy `acl:defaultForNew` grants. ACP discovery
or mixed-policy RDF blocks sharing changes even when an own WAC-looking ACL already exists.
Every policy read is checked regardless of filename, and changed ACL discovery endpoints block writes.

Shared links use a separate view-only read path for another pod on the signed-in storage's
origin, matching Docs' link origin boundary. Public-readable workbooks open anonymously.
Private workbooks shared from another pod are not supported yet: pod-auth and the session
layer cannot authorize a single foreign workbook on an existing session. A 401 or 403 explains
that access is needed from the owner's pod instead of opening the editor.
Cross-origin links, credentials in URLs, ambiguous paths and redirects are refused with an
explanation. Reads stay within the validated workbook;
mutations remain restricted to the user's own Sheets container. Shared views never acquire a
writer or consume another account's pending edits.

An explicit lack of Write in either authoritative resource's `WAC-Allow` header opens
the editor with “View only”. A save rejected with 403 switches the mounted engine to
the same mode and stops subsequent autosaves, including reconnection and teardown saves.
Unknown permission hints allow editing until a save supplies a definitive response.
Existing local edits remain available to download or copy after write access is lost.
Reopening view-only preserves their pending queue and unload warning across repeated navigation.
Reopening after Write is restored unlocks those edits and resumes saves when online.

At phone widths the compact engine hides the ribbon, leaving the File menu, a single-line
formula bar and horizontally scrolling sheet tabs with a fixed add button. The header
truncates long titles and save messages to leave room for Share.

The list and editor chrome use native links, labelled controls and suite dialogs. The grid
is engine-rendered: canvas cell contents and cell navigation are not fully exposed to screen
readers. Its labelled region includes a hidden explanation. The browser accessibility tests
cover the list and editor chrome, excluding the Univer container; they do not certify grid
accessibility. CSV export provides a text representation of the active sheet's values.

Autosave serializes all writes, debounces edits for one second, holds edits offline, retries
on reconnection, and stops on conflicts until a version is chosen. Visibility/pagehide and
unmount flushes are best effort under the current service contract; browser termination is
not a durable offline queue, and the contract has no keepalive option.

`window.__sheetsEngine` exists only in builds with `NEXT_PUBLIC_DEV_FIXTURES=1` for browser
round-trip tests. The list route never imports the Univer preset or its facade at runtime.

Cell comments use Docs' Web Annotation vocabulary, typed RDF accessors and guarded
`rdf-io` helpers. One Turtle document per thread root or reply lives at
`<workbook>/comments/<uuid>.ttl`; the comments container has no own ACL, so newly
created resources inherit workbook sharing. Existing child ACLs remain authoritative.
Creates use `If-None-Match: *`; edits, resolution, anchor shifts and deletes use
strong `If-Match` validators. Conflicts retain the draft and report an error.
Deleting your root hides the thread; other authors' reply resources are retained.

Each root is an `oa:Annotation`, motivated by `oa:commenting`, targeting an
`oa:SpecificResource` whose source is the workbook's `index.ttl#it`. Its
`oa:FragmentSelector` has `rdf:value` `sheet=<URI-encoded stable sheet ID>&cell=B3`.
This small fragment convention identifies a single canonical, relative A1 cell;
it uses the engine's opaque, case-sensitive sheet ID so renaming a sheet cannot
break the anchor. It needs no text-quote or fuzzy anchoring from Docs. Bodies are
`oa:TextualBody` with plain `rdf:value` text, rendered by React as text. Replies
are separate annotations motivated by `oa:replying` targeting the root annotation.
All entries carry a creator WebID and created/modified dates. Resolution reuses
Docs' `pd:resolved`; `https://jeswr.org/ns/sheets#cellDeleted` marks removed cells.
Malformed/foreign targets and empty or over-10,000-character bodies are isolated
when listing; missing dates, body nodes and selector fields are rejected.

The labelled Comments region contains a thread list with replies, own-comment
edit/delete actions and resolve/reopen. The toolbar's Comment button and
Ctrl+Alt+M capture the selected cell; selecting a thread navigates the grid, and
selecting its cell highlights the thread. The toolbar counts threads on the active
sheet. There is no canvas marker or thread-comment preset dependency. Append
permission on the comments container enables adding/replying even when the grid
is view-only. Write is needed for changing existing comments. Missing permission
hints disable writes; refresh comments after permissions change. Anonymous shared
views retain the existing credential-free, view-only boundary.

The adapter observes Univer's row/column insert/delete mutations, including their
inverse mutations during undo/redo, and shifts anchors with the existing refs
helpers. Deleted anchors retain their last cell and display “Cell deleted”; a
missing sheet is also displayed that way. Deleted anchors are tombstones and do
not attach to a later insertion at the same coordinate. Comments and workbook
snapshots are separate guarded resources, so a workbook save and anchor updates
are not an atomic transaction. Anchor-update failures are shown in the panel;
reload comments to inspect the stored anchors before further structural edits.
Changes made by another client are refreshed when the window gains focus or via
Refresh comments. Unsupported structural operations such as cut/move are outside
this row/column mutation bridge.
