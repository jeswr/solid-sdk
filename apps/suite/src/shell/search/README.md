<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Mount `ShortcutsProvider` once around the shell and `GlobalShortcuts` once inside it.
`GlobalShortcuts` owns the palette and help dialog by default; `onOpenPalette` and
`onOpenHelp` let the shell own those dialogs instead. `useShortcut` accepts an optional
`scope`: editor beats app, app beats global, and later registration wins within a scope.
Non-Global groups default to app scope. `when` is evaluated on each key event, and disabled
registrations do not shadow enabled ones. Unmounting removes registrations.
`ShortcutsTable` is also the read-only Settings shortcuts view. The frame owns `[` and `]`.

`GlobalSearch` accepts an injectable `SearchSource`, optional current-app scope, and callbacks
for opening a result and the results page. Exported source/result types live in
`../lib/search-results.ts` (also re-exported by `global-search.tsx`). The parent owns routing;
this lane does not mount `/search`. Render `SearchResultsView` inside that route's page, which
owns its heading and request lifecycle. Pass `accountId` and result `owner` metadata to support
the Me filter; unknown owners are excluded. Results preserve relevance order. The list renders
an overscanned window of fixed-height rows and exposes native links and a keyboard-scrollable region.

`createLocalSearchSource(items)` indexes titles and optional body text with `src/lib/search`'s
BM25 index and preserves navigation metadata. Create and populate it per account from opened or
synced items; discard it when the account changes. It performs no storage reads itself.
The fixtures use this same adapter for synthetic examples of all five result types, with eight
files to exercise capping. Slow mode adds an abortable deterministic 1200 ms delay.
