// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

Sheets uses `WorkbookService` for pod storage and a lazy Univer 1.2.0 adapter for the editor.
The service in `lib/workbook/index.ts` stores guarded snapshots and derived CSV/RDF
projections on the active pod.
The demo session uses the same service against the browser's persistent demo pod.

The Data menu sorts the selected range or whole sheet A–Z / Z–A by a column, with
an optional header row. It also creates/removes a range filter and clears its criteria.
The column header filter controls offer values and conditions. Filter resources round-trip
in `workbook.json`; CSV exports and JSON-LD column inference always include every row.
Sorting changes cell contents, so comment anchors, drafts and chart source addresses stay
fixed. Filtered rows remain present and never enter the row-deletion pipeline.

Edit → Find and replace opens Univer's search dialog with match case, whole cell,
values/formulas and current sheet/all sheets options. Ctrl/Cmd+H opens it anywhere in the
editor; Ctrl/Cmd+F opens it from the grid, leaving browser Find available elsewhere.
View-only users can find and filter locally; sort and replacement commands are blocked.
Local viewer filters are omitted from snapshots used for copying/downloading and saving,
and discarded when Write is restored. That transition also clears local undo history.
The initial comments-loading lock blocks sort and replacement; find and filter remain
available.

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
readers. Its labelled region includes a hidden explanation. The browser accessibility specs
audit the rendered list, editor and dialog DOM at 375, 768 and 1280 px in light and dark
themes, failing on serious or critical axe violations. Automated DOM audits do not certify
canvas cell navigation. CSV export provides a text representation of the active sheet's values.

The list searches spreadsheet names without changing stored data. First-run, empty search,
load-error and missing-workbook views use the suite's shared state components. Retry repeats
the failed read; clearing search restores the list. Offline and view-only notices explain
when a connection or Write access is needed. The Playwright flows live in `e2e/sheets/`,
use the remembered demo session and persistent demo pod, and import `e2e/fixtures/sheets-import.csv`.

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
Creates use `If-None-Match: *`; edits, resolution and deletes use
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
Docs' `pd:resolved`. Selectors remain the address where each thread was created.
New roots also record that selector's workbook revision as the string property
`https://jeswr.org/ns/sheets#workbookRevision` on the annotation: the last saved
`workbook.json` ETag, preserved verbatim through the normal RDF read/write path.
Older annotations and other clients may omit it.
Malformed/foreign targets and empty or over-10,000-character bodies are isolated
when listing; missing dates, body nodes and selector fields are rejected.

The labelled Comments region contains a thread list with replies, own-comment
edit/delete actions and resolve/reopen. The toolbar's Comment button and
Ctrl+Alt+M capture the selected cell; selecting a thread navigates the grid, and
selecting its cell highlights the thread. The toolbar counts threads on the active
sheet. There is no canvas marker or thread-comment preset dependency. Append
permission on the comments container enables adding/replying even when the grid
is view-only. Edit/delete appear only when the claimed creator matches the signed-in
WebID and that comment resource advertises user Write in `WAC-Allow`. Resolution
also requires resource Write. Container Write alone never enables these actions.
Missing permission hints disable changes; refresh comments after permissions change. Anonymous shared
views retain the existing credential-free, view-only boundary.

Current thread locations live in `workbook.json` as
`commentAnchors: { version: 1, anchors: { [annotationId]: { sheetId, cell } | "deleted" } }`.
The optional collection and each address are Zod-validated on snapshot save/open.
Invalid entries are ignored independently; valid anchors, charts and workbook cells survive. Readers use
this map when present and otherwise use the annotation's creation selector.
The adapter observes Univer row/column insert/delete mutations and transforms the
whole map and chart sources synchronously with workbook state. A shared structural
command checkpoint includes
deletion history in the same undo/redo entries as the cells. Undo and redo shift
all anchors and open drafts, including those created after the command. Only
reversing the command that deleted a cell revives its anchors; an unrelated
insertion leaves them deleted. Editing stays locked from engine mount until the
initial comment load settles. Later refreshes leave editing available. A failed load releases editing,
CSV import, chart editing and undo/redo, shows an error with Retry, and disables comment actions
until a load succeeds. Anchor discovery runs independently of permissions, so a successful
listing still registers anchors when permissions fail. The adapter keeps a per-mount log
of structural transforms, each tagged with the last saved workbook revision before it,
and their undo/redo deletion identities. Save acknowledgements retain the exact snapshot's
position in this log, including when editing continues during the write. Newly discovered
selectors replay only edits after their recorded revision, including tombstones and their
restoration. If that revision is absent from the log, only an exact match with the mount
snapshot's revision permits replay from the mount; unknown, older or missing revisions
register the selector as written.
A newer snapshot reload clears the log; CSV import retains it. Locally created drafts already
track current coordinates and bypass rebasing. Registered anchors continue following edits. This lock cannot
override view-only access. These anchors
commit atomically with the guarded workbook snapshot; reloading a winning revision
discards the losing client's transformations. Moving anchors never writes comment RDF.
Deleted anchors and missing sheets display “Cell deleted”. Open drafts follow the
same transforms and cannot be sent after their cell is deleted. Drafts stay out of
the persisted map. Once creation succeeds, the draft clears and shows “Comment sent.”;
a failed subsequent refresh retries only reading the comments.

Solid does not provide verifiable authorship for an appended resource. As in Docs,
`dct:creator` is a claimed WebID, not authenticated provenance. The resource Write
check limits offered actions; it does not prove authorship or enforce ownership.
Anyone with inherited Write can modify or delete resources directly, including
another creator's comments. Servers enforce resource permissions, not this client
policy. This implementation does not add signatures.

Comments refresh when the window gains focus or via Refresh comments. Unsupported
structural operations such as cut/move are outside the row/column mutation bridge.

Charts (SHT-05) are app-owned SVGs in a scrollable strip below the grid. This avoids
coupling their position and keyboard controls to Univer's canvas coordinates or its Pro
chart plugin. The editor and chart renderer are lazy chunks; the list page loads neither.
Insert chart uses the active selection. The chart editor supports column, bar, line, pie
and scatter charts, an A1 range on the original sheet (optionally sheet-qualified),
a title, legend, and series from rows or columns. Text edges are detected as headers;
blank/non-numeric cells are gaps, and numeric text is accepted. Pie uses positive values
from the first series; scatter pairs the first numeric series with each remaining series.
Series colours use the shared `--chart-1` through `--chart-5` theme tokens. Each SVG has
an accessible title and a series summary. The strip updates after cell edits and formula
results, and the editor uses native labelled keyboard controls.
View-only workbooks still render the chart strip, but disable insert and edit controls
and hide the chart editor. The engine also blocks chart changes, including source restoration
from undo history, after write access is lost.

`workbook.json` retains the existing engine snapshot and adds `charts: { version: 1,
entries: [...] }`. Zod validates the collection and each entry on save/load; invalid entries
(including unknown versions, duplicate IDs, and missing/out-of-bounds sources) are ignored
and reported as content-free console warnings. Legacy snapshots need no migration.
Row/column mutations shift chart sources during forward edits, undo and redo, including charts
created after a command. Deletions record the current source and its revision before each replay,
including redo. Undo restores that range only while the revision is unchanged; manual sheet or
range edits increment the revision, while presentation edits preserve it. An open chart editor
uses the live source on Apply unless its range field was changed. Fully deleted
sources stay saved with `range: null` and show “Data range deleted”. Source validity is
independent of the rendering budget: ranges above 10,000 cells remain saved and show
“Range too large to chart” until reduced.
Chart controls and the adapter also block chart changes while comments load.
Charts follow the existing guarded autosave and conflict flow. XLSX import/export behavior
is unchanged: charts are **not exported to XLSX**, and imported Excel charts are not read.
