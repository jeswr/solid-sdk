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

## DS-05 async surfaces

`EmptyState` supports first-use, no-results, filtered-empty, no-access and
not-available-offline. Supply a verb-first `primaryAction` and optional
`secondaryAction`; filtered/offline variants also accept `onClearFilters` / `onRetry`.
`LoadingSkeleton preset="list|grid|document|detail|table"` reserves density-backed rows
and cards. Decorative placeholders are hidden from assistive technology; loading and
empty feedback use status regions, while `ErrorState` uses alert regions.

Pass the façade's category to `ErrorState error={category}` or
`error={{ category, retryAfterMs }}`. `errorStateCopy` and `errorActionLabels` are the
01 §9 copy/action map. Supply `actions` keyed by recovery action, with callbacks or
native-link destinations. Access requests additionally require `accessRequests={true}`.
Reauth retains a skeleton; the host supplies session/conflict dialogs via callbacks
and `children`. Retry stays disabled until `retryAfterMs` expires. Keep each classified
error object stable between rerenders and replace it for each new error occurrence,
including repeated errors with the same category and delay. Report links must
be supplied with redacted context; this component never reads raw exceptions.
Collections accept `errorActions`, `accessRequests`, and error-state `retryAfterMs`.

`renderAsync({ loading, error, empty, children })` takes conditional React nodes,
prioritises first-load → error → empty → content, and accepts a lazy `children` function.
Both collections and the content/upload feedback adapters use it. For refreshes, pass
no loading node and keep content; the host owns the TopBar progress indicator.

Use the exported `toast` with `Toaster`: ordinary messages last 5 seconds, actions
labelled `Undo` last 8 seconds, and errors persist with a dismiss button. For React-node
or localised Undo labels, select the same window explicitly with
`{ duration: toastDurations.undo, action: { label: <span>Undo</span>, onClick: undo } }`.
This duration option also applies to promise options and extended success results;
errors always persist. Errors announce alerts; ordinary messages announce status.
Toast only when the outcome is not already visible in place.

Dev routes: `/dev/components/{empty-state,error-state,loading-skeleton,toasts,render-async}`.
The DS-05 browser spec writes all viewport/theme captures to `artifacts/screens/DS-05/`;
Chromium execution and visual review belong to the dispatcher.

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
Collapsed docks mount no file rows. Expanded queues use the same TanStack virtualizer as
the collections, with measured row heights and list position/count semantics. Tab moves
through the file actions across virtual windows; Up/Down and Home/End move between files,
and Escape collapses the dock and focuses its toggle. The summary live region includes
the entire queue, including rows outside the viewport.

`DropZoneOverlay` wraps a folder pane and returns `{ files: [{ file, path }], directories }`.
Paths are relative, directory paths end in `/`, and empty dropped directories are retained.
All directory reader batches are exhausted. File/folder buttons provide keyboard alternatives;
the folder picker uses the browser's `webkitdirectory` API. Non-file drags pass through.
The returned paths are display paths: the app's upload planner applies storage naming rules.
`readDrop(captured, options?)` and `filesFromPicker(files, options?)` accept `DropReadOptions`:
`maxEntries` (10,000 files and directories combined), `maxDepth` (32, with a dropped root at
depth zero), `timeoutMs` (30,000 for the whole read), and `signal`. Bounds must be finite
integers; counts/depth may be zero and the timeout must be positive. They reject/throw a
`DropReadError` with `code` equal to `limit-exceeded`, `aborted`, or `timeout`; limit errors
also identify `limit` (`maxEntries` or `maxDepth`). No partial upload is returned. Browser
read failures still propagate their original error. The synchronous picker checks bounds,
cancellation and elapsed time between files; asynchronous directory/file callbacks are
also interrupted by cancellation or the deadline, even if the browser never responds.
Pass `readOptions={{ maxEntries, maxDepth, timeoutMs }}` to `DropZoneOverlay` to override
these defaults. Escape and unmount abort traversal; Escape restores browsing and focus.
Late browser callbacks cannot deliver cancelled files. Limit/timeout errors show recovery
feedback and clear the busy state. The caller still owns any work started by `onFiles`.

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
classify SDK errors themselves. Error feedback keeps that callback available as Sign in
for reauth and Retry for every other category. Fixtures live at `/dev/components/upload-dock`,
`/dev/components/drop-zone-overlay`, and `/dev/components/preview-pane` in `apps/suite`.

## DS-12 typed content and storage

DS-12 adds `TypedView`, `ItemDetails`, and `PodMeter`. Import `styles/components.css`
after the token styles. `TypedView` accepts a `TypedViewData` projection from typed RDF
accessors; its registry maps RDF class IRIs to renderers and can be extended with a
caller-owned map. The suite app's `src/components/typed-view-data.ts` supplies the adapter.
Technical serialization is rendered only when `showTechnicalDetails` is true, inside a
native disclosure. Bind that prop to Settings › Advanced, never to the resource itself.

`TypedView` and `TypedRendererProps` accept an optional `resolveImage: ImageResolver`,
`(url: string, signal: AbortSignal) => Promise<string | undefined>`. Supply a stable resolver
that reads through the authenticated SDK and returns an object URL. Contacts, tracks and
photos show a placeholder while resolving, after rejection/undefined/unsafe output, and
after image load errors. Reads are aborted on URL/resolver changes and unmount; late
results are ignored. The caller owns object URL creation, caching and revocation, including
URLs from aborted reads. Caller-supplied `blob:` image sources render directly without
calling the resolver. Existing HTTP(S) and local `/path` image sources still work without
a resolver; unsafe schemes, credentials and protocol-relative URLs remain rejected, and
link URL policy is unchanged. Custom registry renderers receive the resolver too.

`ItemDetails` is the content of the details pane: metadata, an actions slot, and the
structural result of `share.get`. Pass `ownerId` to exclude the owner from the people
count, resolved names in `people`, and `onManageAccess` to open the consuming screen's
share dialog. Render it inside the shell's `DetailsPane` (`@jeswr/suite-ui/shell`), which
owns the responsive pane or sheet; the consumer owns loading, refresh and errors.
`PodMeter` takes usage in bytes and an optional quota; absent quota never implies a
percentage. All three accept `ContentSurfaceState` for loading, empty and classified errors.
Its error branch accepts `actions: ErrorRecovery`, `accessRequests`, and `retryAfterMs`,
including `ItemDetails.accessState`. Legacy `onRetry` remains a fallback for Sign in on
reauth and Retry on other categories; explicit `signIn` / `retry` actions take precedence.
Upload and preview components use the separately exported `SurfaceState`.
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## App navigation (DS-03)

Import `@jeswr/suite-ui/styles/navigation.css` after the token, theme and density styles.
`AppRail`, `AppLauncher`, and `BottomTabBar` take `currentApp` and an optional `apps`
registry. Each registry entry supplies its native navigation path and optional Create actions.
The desktop rail is 56px from 768px; the mobile bar uses Home, Drive, Docs, Tasks and More.
Bell, offline and account controls are named slots on `AppRail`; the account menu itself
belongs to the shell lane.

Wrap navigation in `RailPreferencesProvider` with the active account's preference value,
update callback, loading/save state, classified error and retry callback. Components consume
that binding through `usePreferences('rail')`. This UI adapter does not implement pod storage:
SDK-APP-11 owns persistence, account isolation, cache and offline writes. The dev fixtures use
an explicitly fixture-only browser key to exercise persistence until that SDK is present.

The launcher grid renders the DS-02 `AppIcon`; `AppSlug` is the same id set as `AppId`.
While preferences are loading or failed, the Customise rail panel is read-only.

The launcher uses a Radix popover with a native search input and an ARIA layout grid of
native links. Tab enters the grid; arrows move between apps; Home/End move within a row
(Ctrl moves to the first/last app); typing filters; Enter follows the link; Escape closes
and restores trigger focus. Checkboxes and Move up/down controls provide alternatives to
pinning/reordering by drag. Backlog apps are excluded unless
`NEXT_PUBLIC_SHOW_BACKLOG_APPS=1`, then appear in a collapsed Coming soon group.

Fixtures: `/dev/components/app-rail`, `/dev/components/app-launcher`, and
`/dev/components/bottom-tab-bar`. The DS-03 browser spec writes full-page screenshots to
`artifacts/screens/DS-03/` for all configured widths/themes, with axe and 320px reflow checks.
Run it again with `NEXT_PUBLIC_SHOW_BACKLOG_APPS=1` to capture the flagged backlog states.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
## DS-04 shell layout

Shell components live in `@jeswr/suite-ui/shell`; also import `styles/shell.css`.
`ShellFrame` accepts TopBar slots, a `SidebarNav` model, optional `DetailsPane`
content, and rail/tab-bar slots. It owns the single visible page `h1`, the
`main-content` skip target, the main scroll area and the document title
(`shellDocumentTitle(page, app)`: `page · App · Solid Suite`). Next.js routes should
also export `metadata.title` built with `shellDocumentTitle`, because the layout's
metadata title replaces a title set on mount. Content should start
at `h2`. Set `skipLink={false}` when the root layout already provides that link.

`preferences` / `onPreferencesChange` connect to the consuming app's preferences
hook. Both `sidebarOpen` and `detailsOpen` accept `null` for the responsive default
(open at ≥1024, closed below). Explicit boolean choices override that default.
The package performs no storage or network writes; the dev fixtures use a browser
storage adapter until SDK-APP-11 is available. Bracket shortcuts ignore editable
fields, modified/composing events and unrelated dialogs. Sheets trap focus and
restore it to the corresponding TopBar control on close.
On wide viewports an unconsumed Escape inside the details pane closes it
(01-§6), except in editable fields and nested dialogs.

Sidebar width is 264px; details width is 360px. Below 1024 both use modal side
sheets and at most one is open: when saved preferences open both, the sidebar sheet
shows, the details toggle reports collapsed, and any change writes back one region. At 768 the rail remains visible; below 768 the tab-bar slot replaces it
and the TopBar is 48px. The details breakpoint follows the DS-04 task and 02-§2 (sheet below
1024), not the ≥1280 persistent pane in 01-§4 and the mockups.
Dev routes: `/dev/components/{shell,top-bar,sidebar-nav,details-pane}` in apps/suite.
