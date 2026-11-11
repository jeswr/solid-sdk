---
name: suite-i18n
description: Use when adding translated strings or locales to Solid Suite, consuming typed message catalogs, formatting locale-sensitive values, or wiring an app to the suite language provider.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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

The suite root owns `SuiteI18nProvider`: its account preference beats browser languages;
it updates document `lang`/`dir` before paint. Store changes through `usePreferences('locale')`,
using the empty string for automatic browser language. Do not add a second storage mechanism.

Run package tests and typecheck. Catalog parity tests call `validateCatalog` for every locale
and fail for unknown keys or mismatched parameter names/kinds, including nested branches.
Extend those tests for grammar changes. Keep the runtime parser and compile-time parameter
parser in agreement; negative type tests must still fail as expected.
