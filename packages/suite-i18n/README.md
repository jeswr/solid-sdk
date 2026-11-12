<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/suite-i18n

Dependency-free message formatting and typed catalogs; the optional `./react` entry uses a
React peer. Includes Solid Suite's English source and machine translations for Spanish,
French, German, Portuguese and Arabic. Missing translations fall back per key to English, using English grammar and formatting.
The separate Intl helpers retain the active locale.

```ts
import { createI18n, validateCatalog } from '@jeswr/suite-i18n';
const english = { files: '{count, plural, one {# file} other {# files}}', hello: 'Hi {name}' } as const;
const catalogs = { es: { hello: 'Hola {name}' } };
const i18n = createI18n({ english, catalogs, locale: 'es-MX', warn: console.warn });
i18n.t('hello', { name: 'Ada' }); // Hola Ada
// i18n.t('files', { count: '2' }); // compile error: count must be a number
validateCatalog(english, catalogs.es); // [] — assert this in your tests
```

Use nested objects and `as const` for the English source. `PartialCatalog<typeof english>`
allows partial nested translations. `MessageKey` and `MessageParameters` supply key and
parameter types. `validateCatalog` checks unknown keys, shape changes, syntax and parameter
names/kinds at runtime, including parameters in unselected branches.

Grammar: `{name}`, `{count, plural, =0 {none} one {# file} other {# files}}` and
`{role, select, editor {Edit} other {Read}}`. Choices may nest; `other` is required.
`#` uses the closest enclosing plural's count, formatted with `Intl.NumberFormat`.
Backslash escapes the next character: write `\\{literal\\}` in a JS string for literal
braces, `\\#` for a literal pound sign, and `\\\\` for a backslash. Apostrophes are ordinary
text. Offsets, ordinals, date/number expressions and ICU apostrophe quoting are outside this
subset. Inputs are bounded to 20,000 characters and 32 choice levels. No eval or HTML output;
render the returned string as React text. Values are never reparsed as messages.

`compileMessage(source)` parses once and returns a reusable formatter; `formatMessage` parses
on every call. A translator caches each catalog message's parse, so repeated `t()` calls do
not re-parse. `formatMessage` throws on malformed syntax or missing/wrong parameter values. A translator
tries the selected message, then English, then returns the key; `warn` optionally reports
missing/invalid messages. Unknown keys are rejected by TypeScript, with runtime fallback for
untyped callers. Supply `warn` only in development if desired.

`negotiateLocale(stored, navigator.languages, supported?)` prefers the stored locale, then
browser preferences, then `en`. It tries exact regions/scripts, base languages, then an
available regional variant. `dir` recognizes Arabic, Hebrew, Persian and Urdu. Translators
expose locale-bound `date`, `time`, `number`, `relativeTime` and `list` Intl helpers; options
pass through to Intl. `createFormatters(locale)` exposes those helpers separately.

```tsx
import { I18nProvider, useT, useLocale, useFormatters } from '@jeswr/suite-i18n/react';
// These bindings use the suite catalogs. An absent provider uses English.
function Label() { const t = useT(); return <span>{t('apps.home')}</span>; }
// <I18nProvider locale="es"><Label /></I18nProvider>
```

The React peer is optional: the root entry has no dependencies. The host app and
`@jeswr/suite-ui` must resolve one copy of `@jeswr/suite-i18n` (one React context); with a
second copy, suite-ui's components cannot see the host's provider and fall back to English.
In a pnpm workspace use `workspace:*` in both; elsewhere dedupe the package.

Device-level choice: `readDeviceLocale()` and `writeDeviceLocale(locale | "")` keep the last
explicit choice in `localStorage` (`DEVICE_LOCALE_KEY`, `suite.locale.v1`; failures are
swallowed), for use before an account's preferences load. `localeBootScript()` returns a
constant inline script that sets `<html lang dir>` from that choice or browser languages
before hydration; a build that hashes inline scripts into its CSP covers it unchanged.

For another catalog, `createI18nReact({ english, catalogs, warn? })` returns an independently
typed `I18nProvider`, `useT`, `useLocale` and `useFormatters`. Providers are controlled: own
locale persistence in the app, update the locale prop, and set document lang/dir there.

See [SKILL.md](SKILL.md) for adding strings and locales. Run `pnpm --filter @jeswr/suite-i18n
run test` and `run typecheck` after changes.
