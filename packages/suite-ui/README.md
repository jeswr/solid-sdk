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
# Sharing and consent (DS-09)

Import `PeoplePicker`, `RoleSelect`, `DurationChips`, `ConsentSheet` and `PermissionRow` from
`@jeswr/suite-ui`, and import `@jeswr/suite-ui/styles/sharing.css` after the token styles.
All data and selected values are controlled props. Callbacks report user intent; components
never fetch, write permissions, resolve email remotely or compute protocol grants.

`PeoplePicker` takes a contacts snapshot, query/value callbacks and a `useProfile(webId)` hook.
Pass the SDK hook from the consuming integration. Email entries resolve only against the supplied
contacts; unresolved emails ask for an Account ID. Profile names override contact names and the
Account ID remains visible. `RoleSelect.options` accepts a disabled flag and required reason per
role; `DurationChips` accepts the same pair for its entire group. Custom dates are ISO date strings.

`ConsentSheet` takes an open flag, selected data-type IDs, duration props and account choices.
The caller preselects the requested data types and duration. Share is disabled for an empty
selection or missing custom date. Cancel asks for confirmation before calling `onCancel`.
`PermissionRow` takes controlled expansion and per-item values, with a confirmation before
`onRevoke`. Callers own immediate writes, rollback, inherited-grant handling and undo timing.

`SharingState` describes loading, first-use, filtered, typed errors and offline states. Cached
offline content stays visible with sharing controls disabled. Retry/clear callbacks belong to the
consumer. Dev examples live at `/dev/components/{people-picker,role-select,duration-chips,consent-sheet,permission-row}`.
