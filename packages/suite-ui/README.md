<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-ui

Normative tokens from `01-design-system` §2.1–2.7 and Amendment 2026-10-25. Import `styles/tokens.css`,
`styles/theme.css` (Tailwind v4), `styles/density.css`, `styles/components.css`,
and `styles/collections.css`, in that order. Set `.dark` for dark
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

## DS-02 primitives and atoms

Import `@jeswr/suite-ui/styles/components.css` after the token, theme and density styles.
Tailwind v4 consumers must scan this package's `src/` (or emitted `dist/`) with `@source`.
The source preserves Next.js client boundaries; all exports are available from `@jeswr/suite-ui`.
The shadcn source provenance and MIT notice are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

`components/ui/` contains the §5 shadcn/Radix primitives, Command (cmdk), Calendar
(react-day-picker 9), Form (react-hook-form + Zod), Toast (`Toaster` / `toast`, sonner),
and Resizable. Controls inherit `--control-h` / `--control-h-sm`; focus is a 2px ring
with a 2px offset. Menus, dialogs and sheets use the suite surface/elevation tokens.

Use `IconButton label="Add item"` for an icon-only action. Its required nonblank label
supplies both `aria-label` and the hover/focus tooltip. Disabled icon buttons remain
focusable with `aria-disabled` so the label stays discoverable, and suppress activation.
The package's AST lint test rejects literal icon-size Button usages without both a name
and Tooltip. Prefer IconButton for dynamically selected icon sizes as well.

Atoms: `AppIcon app size` (15 apps, 32/40/48); `FileTypeIcon contentType name size`
(with optional `thumbnailSrc`); `ProvenanceBadge source logoSrc` (root-relative local
logos, letter fallback on absence/error); native `Kbd`; labelled live `StatusDot`; and
`CountBadge count` (nonnegative safe integers, visible zero, 99+ cap, full accessible count).
App/file icons can be `decorative` beside existing text. File metadata takes precedence
over filename fallback; unknown JSON is not assumed to be JSON-LD.

The dev-only host exposes `/dev/components/primitives`, `/dev/components/atoms`, and
individual component routes linked from `/dev/components`. `ds-02-components.spec.ts`
checks axe, keyboard interaction, focus, density, touch targets and 320px reflow, and writes
full-page screenshots under repo-root `artifacts/screens/DS-02/`. Chromium execution and
visual comparison belong to the dispatcher. Unit axe checks run in jsdom; contrast is
covered by the token gate and the browser tests.

## DS-06 collections and selection

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

## DS-07 editing and navigation

DS-07 exports `Toolbar`, `FilterChips`, `Breadcrumbs`, `EditableText`, and `TagInput`.
Import `@jeswr/suite-ui/styles/components.css` after the token styles. Components use
React 19, Radix dropdown menus, and Lucide icons. Consumers supply controlled values,
unique item IDs, and synchronous callbacks; persistence and remote fetching stay in the app.

- `Toolbar`: ordered `actions` (`id`, `label`, `onSelect`, optional `icon`, `primary`, `disabled`);
  measures intrinsic widths with ResizeObserver and preserves order in More. Left/Right/Home/End
  move focus, with one tab stop. Supply decorative Lucide icons when needed.
- `FilterChips`: `options`, selected `value` IDs, `onChange`, and `resultCount`; announces the
  result count politely. Clear removes every selection.
- `Breadcrumbs`: `items` with `id`, `label`, `href`, optional `onDrop`; preserves first/current
  segments and collapses middle segments when they do not fit. Its item type is `BreadcrumbsItem`. Supply a keyboard move action in
  the consuming app alongside drag and drop. Links remain native anchors, including in the menu.
- `EditableText`: `label`, `value`, `onCommit`, optional `validate` returning an error string,
  optional `disabled`. Click/F2 edits, Enter validates and commits, Escape cancels. Blur leaves
  the draft open; IME composition does not commit.
- `TagInput`: `label`, local `options`, selected `value` IDs, `onChange`, optional `disabled`;
  filters available options, arrows/Enter select, Escape closes, and an empty-input Backspace
  removes the last tag. Each chip also has a labelled removal button. No free-form creation.

Interactive fixtures live in `apps/suite` at `/dev/components/<component>` (kebab-case).
The component tests use Vitest, jsdom, Testing Library and axe-core; Playwright runs real
layout, contrast, keyboard, and screenshot checks across the six viewport/theme projects.
## DS-11 uploads and previews

DS-11 exports `UploadDock`, `DropZoneOverlay`, `PreviewPane`, and the pure
`uploadQueueReducer`. Import `@jeswr/suite-ui/styles/components.css` after the token,
Tailwind theme and density styles. The modules preserve their React client boundaries.

`UploadDock` takes controlled `items` and `onPause/onResume/onCancel/onRetry` callbacks.
The reducer enforces valid transitions and at most three active uploads. Pass the item's
`attempt` back in progress, complete and fail events to ignore stale transport callbacks.
The caller must abort paused/cancelled requests, schedule queued work, persist the queue,
and implement storage capabilities. Set `canPause={false}` when pausing is unavailable.

`DropZoneOverlay` wraps a folder pane and returns `{ files: [{ file, path }], directories }`.
Paths are relative, directory paths end in `/`, and empty dropped directories are retained.
All directory reader batches are exhausted. File/folder buttons provide keyboard alternatives;
the folder picker uses the browser's `webkitdirectory` API. Non-file drags pass through.
The returned paths are display paths: the app's upload planner applies storage naming rules.

`PreviewPane` takes `{ name, blob, contentType?, typedView?, details? }` as `source`.
The owning app supplies parsed typed data through `typedView={<TypedView ... />}`; the
preview never parses or displays raw data files. Unsupported types and failed media keep a
local download action. Image zoom (100–400%) supports +/−, arrow-key panning and pointer drag.
Text/Markdown offers rendered/raw views for blobs up to 1 MiB; larger files keep the download action. Markdown HTML is ignored, unsafe link schemes are
removed, and remote image requests are suppressed. Object URLs are revoked on replacement
and unmount. Supply blobs already read through the SDK; this package makes no network reads.
The host owns preview navigation, metadata retrieval, headings and the enclosing dialog.

All three accept `state` (`ready`, `loading`, `empty`, `filtered-empty` with `query`,
`error` with a classified `SurfaceError`) and an `onAction` recovery callback. They do not
classify SDK errors themselves. Fixtures live at `/dev/components/upload-dock`,
`/dev/components/drop-zone-overlay`, and `/dev/components/preview-pane` in `apps/suite`.

## DS-12 typed content and storage

DS-12 adds `TypedView`, `DetailsPane`, and `PodMeter`. Import `styles/components.css`
after the token styles. `TypedView` accepts a `TypedViewData` projection from typed RDF
accessors; its registry maps RDF class IRIs to renderers and can be extended with a
caller-owned map. The suite app's `src/components/typed-view-data.ts` supplies the adapter.
Technical serialization is rendered only when `showTechnicalDetails` is true, inside a
native disclosure. Bind that prop to Settings › Advanced, never to the resource itself.

`DetailsPane` accepts metadata, an actions slot, and the structural result of
`share.get`. Pass `ownerId` to exclude the owner from the people count, resolved names
in `people`, and `onManageAccess` to open the consuming screen's share dialog. The
consumer hosts the pane in its responsive sheet and owns loading, refresh and errors.
`PodMeter` takes usage in bytes and an optional quota; absent quota never implies a
percentage. All three accept `ContentSurfaceState` for loading, empty and classified errors.
Upload and preview components use the separately exported `SurfaceState`.
