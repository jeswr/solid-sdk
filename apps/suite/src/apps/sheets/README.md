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

Shared links use a separate view-only read path for another pod on the signed-in storage's
origin, matching Docs' link origin boundary. Cross-origin links, credentials in URLs, ambiguous
paths and redirects are refused with an explanation. Reads stay within the validated workbook;
mutations remain restricted to the user's own Sheets container. Shared views never acquire a
writer or consume another account's pending edits.

An explicit lack of Write in either authoritative resource's `WAC-Allow` header opens
the editor with “View only”. A save rejected with 403 switches the mounted engine to
the same mode and stops subsequent autosaves, including reconnection and teardown saves.
Unknown permission hints allow editing until a save supplies a definitive response.
Existing local edits remain available to download or copy after write access is lost.
Reopening view-only preserves their pending queue and unload warning across repeated navigation.

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
