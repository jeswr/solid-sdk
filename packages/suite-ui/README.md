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
  segments and collapses middle segments when they do not fit. Supply a keyboard move action in
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
