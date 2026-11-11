// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

Sheets uses `WorkbookService` for pod storage and a lazy Univer 1.2.0 adapter for the editor.
The service in `lib/workbook/index.ts` stores guarded snapshots and derived CSV/RDF
projections on the active pod.
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
Charts follow the existing guarded autosave and conflict flow. XLSX import/export behavior
is unchanged: charts are **not exported to XLSX**, and imported Excel charts are not read.
