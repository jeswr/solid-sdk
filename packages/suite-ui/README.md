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
