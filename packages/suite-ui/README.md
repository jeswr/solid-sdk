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
