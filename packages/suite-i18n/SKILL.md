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

The suite root owns `SuiteI18nProvider`: a signed-in account's own preference decides its
language (an explicit choice wins; an account that never chose, or chose Automatic, follows the
browser, never another account's choice). The device key `suite.locale.v1` is only the
signed-out and pre-hydration default: the provider mirrors the active account's resolved choice
to it (removing it for Automatic) on every account change, ignores cross-tab `storage` events
for it while an account is active, and clears it when the last account signs out. It updates
document `lang`/`dir` before paint, and wraps the tree in suite-ui's `DirectionProvider` so
Radix menus and popovers follow RTL. Change the language only through `useLanguageChoice()` or
`<LanguageSelect>` / `<LanguagePicker>` in `apps/suite/src/shell/i18n.tsx`; they write the
account preference and the device key together. In the picker the empty string means automatic;
the account stores that as `"auto"`. The root layout inlines `localeBootScript()` so the first
paint already has the right direction; it validates the stored value exactly like
`readDeviceLocale` and negotiates browser languages like `negotiateLocale`.

String parameters are bidi-safe: embedded U+202A-U+202E and U+2066-U+2069 are stripped, and a
value is wrapped in FSI...PDI only when it holds a right-to-left letter or runs against the
locale's direction. A missing parameter renders an empty isolated value (and warns outside
production), never the key or a `{name}` placeholder.

Keep one copy of this package in the host and `@jeswr/suite-ui` (`workspace:*`); a duplicate
gives suite-ui its own context and its components fall back to English. Store error and status
messages as keys or codes and translate them at render, never as translated text in state.
Write CSS with logical properties (`inset-inline-start`, `margin-inline-end`, `text-align:
start`) and mirror directional icons under `[dir="rtl"]` (suite-ui's `.suite-rtl-mirror`).

Run package tests and typecheck. Catalog parity tests call `validateCatalog` for every locale
and fail for unknown keys or mismatched parameter names/kinds, including nested branches.
Extend those tests for grammar changes. Keep the runtime parser and compile-time parameter
parser in agreement; negative type tests must still fail as expected.
