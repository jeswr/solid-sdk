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

Shell components live in `@jeswr/suite-ui/shell`; also import `styles/shell.css`.
`ShellFrame` accepts TopBar slots, a `SidebarNav` model, optional `DetailsPane`
content, and rail/tab-bar slots. It owns the single visible page `h1`, the
`main-content` skip target, the main scroll area and the document title
(`shellDocumentTitle(page, app)`: `page · App · Solid Suite`). Content should start
at `h2`. Set `skipLink={false}` when the root layout already provides that link.

`preferences` / `onPreferencesChange` connect to the consuming app's preferences
hook. Both `sidebarOpen` and `detailsOpen` accept `null` for the responsive default
(open at ≥1024, closed below). Explicit boolean choices override that default.
The package performs no storage or network writes; the dev fixtures use a browser
storage adapter until SDK-APP-11 is available. Bracket shortcuts ignore editable
fields, modified/composing events and unrelated dialogs. Sheets trap focus and
restore it to the corresponding TopBar control on close.

Sidebar width is 264px; details width is 360px. Below 1024 both use modal side
sheets. At 768 the rail remains visible; below 768 the tab-bar slot replaces it
and the TopBar is 48px. The detail breakpoint follows the DS-04 brief / shell §2;
see the lane's root `QUESTIONS.md` for the design-system table discrepancy.
Dev routes: `/dev/components/{shell,top-bar,sidebar-nav,details-pane}` in apps/suite.
