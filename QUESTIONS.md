<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-xenc conservative interpretations

1. **Currency grammar** (SHT-L3; 07-parity-backlog, Sheets formatting; 11-pure-libraries-3):
   the task names ISO currency codes without a format-code grammar. Options are spreadsheet
   bracket syntax, a structured options object, or literal ISO codes. Use literal uppercase
   codes (`USD`, `EUR`, `JPY`) recognised by the runtime's Intl currency list, with Intl's
   currency-specific fraction digits and code display. Other custom currency patterns fail closed.
2. **Dates and times** (same sections): serial numbers, local Date objects and canonical UTC
   strings are possible. Use immutable, canonical UTC ISO strings at minute precision; Gregorian
   years 0001–9999. Accept `yyyy-mm-dd`, `hh:mm`, and `yyyy-mm-dd hh:mm`; time-only input anchors
   to 1970-01-01. Parse fixed patterns and the locale's Gregorian two-digit date order, but never
   guess time zones, two-digit years, date rollovers or spreadsheet serial epochs.
3. **Parsing ambiguity** (11-pure-libraries-3 fail-closed rule): unsupported numeric/date-like
   syntax could be retained as text or rejected. Reject it with a typed error; a leading apostrophe
   explicitly requests literal text. Boolean keywords are ASCII true/false, case-insensitive.
   Locale digit glyphs, exact grouping and percent affixes come from Intl. No separator guessing,
   exponents, fractions, formula evaluation or currency-symbol guessing. An optional format-code
   argument enables parsing that currency's exact ISO-code display. Decimal input must survive
   conversion without changing its decimal value and stay within the safe-number magnitude.
4. **Percent grammar** (SHT-L3): `%` is explicitly listed, while spreadsheet applications usually
   spell it `0%`. Accept `%` and `0%` as integer percent, plus `0.00%` as the two-decimal variant
   corresponding to `0.00`. Reject all other variants.

These choices permit the scoped pure library to proceed. They require no UI or SDK API changes.
