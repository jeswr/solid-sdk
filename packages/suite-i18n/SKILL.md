---
name: suite-i18n
description: Use when adding translated strings or locales to Solid Suite, consuming typed message catalogs, formatting locale-sensitive values, or wiring an app to the suite language provider.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Suite translations

English in `src/catalogs/en.ts` is the source of truth. Add nested message keys there with
literal types preserved. Add matching translations to the other catalog files; each is a
`PartialCatalog<typeof en>` and may omit keys for English fallback. Keep machine-translation
comments until native-speaker review. Register new locales in `src/locale.ts` and
`src/index.ts`. The suite's preference schema and picker consume the locale list automatically.

Use `useT()` from `@jeswr/suite-i18n/react` in shell and shared UI components. Interpolate via
`t('account.trigger', { name })`; keys and required parameter types come from English.
Pass translated text into shared components or consume the shared provider. Never import
app catalogs from suite-ui. Another application can create independent typed React bindings
with `createI18nReact({ english, catalogs })`.

Plural/select branches require `other`; nesting is supported. Cardinal plural counts must
be finite numbers, select parameters strings. Escape literal braces with backslashes; in a
TS string use `\\{` and `\\}`. This is the bounded subset documented in [README.md](README.md),
without ICU offsets, ordinals or apostrophe quoting. Use the locale-bound Intl helpers from
`useFormatters()` for dates, times, numbers, relative time and lists.

The suite root owns `SuiteI18nProvider`: an account's explicit preference wins once loaded;
before that (signed out, or while the session restores) the device choice applies, then
browser languages. It mirrors each explicit choice to the device key, updates document
`lang`/`dir` before paint, and wraps the tree in suite-ui's `DirectionProvider` so Radix
menus and popovers follow RTL. Change the language only through `useLanguageChoice()` or
`<LanguageSelect>` / `<LanguagePicker>` in `apps/suite/src/shell/i18n.tsx`; they write the
account preference and the device key together. In the picker the empty string means automatic;
the account stores that as `"auto"` (follow the browser even if another account left a device
choice), while an account's `""` means never chosen, so the device choice applies. The device
key is mirrored only when the account's choice changes, never in reaction to the key itself,
because each tab has its own active account. The root
layout inlines `localeBootScript()` so the first paint already has the right direction.

Keep one copy of this package in the host and `@jeswr/suite-ui` (`workspace:*`); a duplicate
gives suite-ui its own context and its components fall back to English. Store error and status
messages as keys or codes and translate them at render, never as translated text in state.
Write CSS with logical properties (`inset-inline-start`, `margin-inline-end`, `text-align:
start`) and mirror directional icons under `[dir="rtl"]` (suite-ui's `.suite-rtl-mirror`).

Run package tests and typecheck. Catalog parity tests call `validateCatalog` for every locale
and fail for unknown keys or mismatched parameter names/kinds, including nested branches.
Extend those tests for grammar changes. Keep the runtime parser and compile-time parameter
parser in agreement; negative type tests must still fail as expected.
