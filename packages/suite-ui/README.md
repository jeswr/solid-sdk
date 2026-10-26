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
