// AUTHORED-BY Codex GPT-6.1-Sol

Sheets uses `WorkbookService` for storage and a lazy Univer 1.2.0 adapter for the editor.
The service in `lib/workbook/index.ts` stores guarded snapshots and derived CSV/RDF
projections on the active pod.

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

`workbook.json` retains the existing engine snapshot and adds `charts: { version: 1,
entries: [...] }`. Zod validates the collection and each entry on save/load; invalid entries
(including unknown versions, duplicate IDs, and missing/out-of-bounds sources) are ignored
and reported as content-free console warnings. Legacy snapshots need no migration.
Row/column commands record exact chart sources in Univer's undo/redo history. Fully deleted
sources stay saved with `range: null` and show “Data range deleted”; undo restores the original
source, including deleted boundaries. Source validity is independent of the rendering budget:
ranges above 10,000 cells remain saved and show “Range too large to chart” until reduced.
Charts follow the existing guarded autosave and conflict flow. XLSX import/export behavior
is unchanged: charts are **not exported to XLSX**, and imported Excel charts are not read.
