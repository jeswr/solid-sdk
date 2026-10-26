<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-ui

Normative tokens from `01-design-system` §2.1–2.7 and Amendment 2026-10-25. Import `styles/tokens.css`,
`styles/theme.css` (Tailwind v4), and `styles/density.css`. Set `.dark` for dark
mode and `data-density="comfortable|compact"` for density. Coarse pointers force
comfortable rows and 44px controls. Reduced motion zeros motion durations.

`tokens` exports the typed inventory, including both themes and compact values.
`fonts` exports `onest`, `sourceSerif`, and `sourceCode` for Next.js root layouts;
apply their `.variable` classes to `<html>` so the `:root` font aliases resolve.
The default entry has no Next.js runtime import.

The frozen `test/spec-tokens.json` is the spec transcription; the snapshot and CSS
parity test guard changes. Run `pnpm check:tokens` and `pnpm check:contrast` at the
workspace root. `--input` supplies form control boundaries with at least 3:1 contrast
against `--background` and `--surface` in both themes. `--border-strong` remains
the decorative border token. Warning text on `--warning` meets 4.5:1 in both themes.

`DataTable`, `FileGrid` and `useSelection` are client components/hooks. Import
`@jeswr/suite-ui/styles/collections.css` after the token and density styles. Both
collections accept `items`, stable `getKey`, `getLabel`, `label`, `onOpen`, and optional
`onDetails`, `selection`, `height` (default 440px) and async surface props. DataTable
also takes flat `DataColumn<T>[]` definitions; FileGrid accepts `renderPreview` and
`renderMetadata`. Preview content must be decorative and contain no interactive controls.

Pass filtered items to the components. A shared `useSelection()` model preserves IDs across
views, filtering and sorting. `selectAll(keys)` adds the visible keys; `toggleAll(keys)`
removes just those keys when all are selected. Plain row/card click replaces selection;
checkbox/Space toggles; Shift extends a range in displayed order. Arrow keys and j/k move
focus, Shift extends selection, Home/End jump, Cmd/Ctrl+A selects visible items, Escape clears,
Enter calls `onOpen`, and Alt+Enter calls `onDetails`. FileGrid's vertical arrows follow its
responsive column count. One item per collection is in the Tab sequence. Table headers expose
sorting, draggable resize handles (also Left/Right keys) and a Columns visibility disclosure.
Wide table columns scroll inside the table region without widening the page.

`state` accepts ready, loading, refreshing, offline (`cached`), or error (`kind`, `actions`).
The host supplies error actions and their session/storage behaviour; retry is an optional callback.
Loading uses skeletons, refreshing retains content, offline without cached items offers Retry,
and zero items use first-use or `filterQuery` empty states (`emptyAction` / `onClearFilters`).
Hosts render their refresh progress in TopBar and can supply session/conflict dialogs as error actions.
Fixtures: `/dev/components/data-table` and `/dev/components/file-grid` in `apps/suite`.
