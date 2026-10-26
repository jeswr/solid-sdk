<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Cell formats (SHT-L3)

Import from `./index`. No engine, React, hooks, I/O or third-party dependencies.

`formatCellValue(cell, code, locale)` displays immutable `{ type, value }` cells.
Types are `number`, `percent` (fraction: 0.25 means 25%), `date` (canonical UTC ISO
minute string), `boolean`, and `text`. Locale is explicit, validated through Intl;
unsupported locales never fall back to the host default.

Supported, case-sensitive codes:

| Code | Display |
| --- | --- |
| `General` | Ungrouped numbers preserving JS decimal precision; percent cells retain percent display; dates use both date and time |
| `0`, `0.00` | Ungrouped integers or exactly two fraction digits, Intl rounding |
| `#,##0` | Locale grouping, integer rounding |
| `%`, `0%`, `0.00%` | Integer or two-fraction-digit percent, Intl affixes |
| `USD`, `EUR`, `JPY`, etc. | Runtime-recognised ISO currency code, Intl minor units/grouping, code displayed explicitly |
| `yyyy-mm-dd`, `hh:mm`, `yyyy-mm-dd hh:mm` | Gregorian UTC components via Intl, locale digits, fixed pattern order/separators, 24-hour clock |

Text and booleans retain their values under supported codes (booleans display
`TRUE`/`FALSE`). Numeric/date format mismatches throw; there is no implicit serial
date conversion. Formatting rounds as the selected code requests; inverse parsing
cannot restore digits discarded by display rounding.

`parseCellInput(input, locale, code = 'General')` recognises locale decimals,
validated grouping, exact locale percent affixes, case-insensitive ASCII boolean
keywords, the fixed date/time patterns, and the locale's Gregorian date order with
two-digit month/day and four-digit year. ASCII or native locale digits are accepted;
mixing digit systems is rejected. Dates become `YYYY-MM-DDTHH:mm:00.000Z`, date-only
values use midnight, and time-only values anchor to 1970-01-01. Years 0001–9999 and
valid Gregorian days only; no rollovers, two-digit years, offsets or seconds. Pass a
currency code to parse its exact Intl code display into a number; symbols alone
are never guessed. A numeric format hint does not implicitly scale plain numbers.

Ordinary text (including blank input) is preserved verbatim. Surrounding whitespace
is ignored only when recognising typed values. A leading apostrophe explicitly
forces literal text and is removed; use it for numeric-looking identifiers or
unsupported syntax. Numeric-looking malformed input is rejected rather than made
text. Numbers must preserve their decimal value through JS conversion, remain
within ±Number.MAX_SAFE_INTEGER, and not underflow. No exponents, hexadecimal,
fractions, formulas or separator guessing. Input is bounded to 1000 UTF-16 units.

All rejected inputs within the TypeScript API types throw `SheetFormatError`, with
`code` equal to `unsupported-format`, `unsupported-locale`, `invalid-input` or
`invalid-value`. See root `QUESTIONS.md` for the spec's conservative interpretations.
