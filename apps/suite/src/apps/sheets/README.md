// AUTHORED-BY Codex GPT-6.1-Sol

Sheets uses `WorkbookService` for storage and a lazy Univer 1.2.0 adapter for the editor.
The service in `lib/workbook/index.ts` is a temporary, account-scoped in-memory stand-in;
replace it with SHT-01's pod service at integration. It does not survive a page reload.

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
