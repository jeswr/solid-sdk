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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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
Text/Markdown offers rendered/raw views. Markdown HTML is ignored, unsafe link schemes are
removed, and remote image requests are suppressed. Object URLs are revoked on replacement
and unmount. Supply blobs already read through the SDK; this package makes no network reads.
The host owns preview navigation, metadata retrieval, headings and the enclosing dialog.

All three accept `state` (`ready`, `loading`, `empty`, `filtered-empty` with `query`,
`error` with a classified `SurfaceError`) and an `onAction` recovery callback. They do not
classify SDK errors themselves. Fixtures live at `/dev/components/upload-dock`,
`/dev/components/drop-zone-overlay`, and `/dev/components/preview-pane` in `apps/suite`.
