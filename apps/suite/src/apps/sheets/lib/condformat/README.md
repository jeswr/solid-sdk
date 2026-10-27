<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Conditional formatting (SHT-L6)

`evaluateConditionalFormats(values, rules)` accepts a readonly rectangular matrix of
already-computed `number | string | boolean | null | { error: string }` values and
returns a fresh matrix of `CellStyle` objects. Unmatched cells receive `{}`. Inputs
are never mutated. Import the API and types from `./index`.

Every rule applies to the entire input range. Rules are ordered highest priority
first: later matches fill in properties the earlier matches left absent. Explicit
`false` and empty strings are set properties. `stopIfTrue` ends evaluation only for
that matching cell, even if the rule's style is empty or its fill was already set.
Scales claim only `fill`, so they compose with font and number formatting.

| Kind | Required fields beyond `kind` |
| --- | --- |
| `cellIs` | `operator`, `value`, `style`; `operator` is `>`, `>=`, `<`, `<=`, `=`, or `<>` |
| `cellIs` with `between` / `notBetween` | `operator`, `min`, `max`, `style`; inclusive bounds |
| `textContains`, `beginsWith`, `endsWith` | `text`, `style` |
| `blank`, `notBlank`, `error`, `noError`, `duplicate`, `unique` | `style` |
| `top`, `bottom` | `count`, `style`, optional `percent: true` |
| `aboveAverage`, `belowAverage` | `style`; strict comparisons |
| `colorScale` | `anchors`: two or three `{ kind, color, value? }` anchors |

Every rule optionally accepts `stopIfTrue: boolean`. Styles support `fill`,
`fontColor`, `bold`, `italic`, `underline`, `strikethrough`, and `numberFormat`.
Colours accept opaque three- or six-digit hex, normalized to uppercase six-digit
hex. `numberFormat` is an opaque string for the caller to render; this library
does not format values. Unknown fields and unsupported colour syntax are rejected.

Comparisons use finite numbers or strings of the same type only. Strings use
locale-independent lowercase and code-unit ordering; text rules also ignore case
and do not stringify other types. Errors, booleans and null never compare. Empty
search text matches every string. Blank means null or an empty string; whitespace
is preserved. Duplicate/unique counts span the full range, with lowercase string
keys, numbers by value (including equal signed zeros), and booleans separately.
Blanks and errors do not participate. `noError` includes blank cells.

Population rules and scales use numeric cells only, including cells stopped by
other rules. Absolute `count` is a positive safe integer, capped to the population
when selecting. Percent `count` is in (0, 100], rounded upward to at least one
numeric cell. Rank ties are included. Average uses a compensated, normalized sum
to avoid overflow with extreme finite values.

Anchor kinds are `min`, `max`, `number`, `percent`, and `percentile`. The first two
omit `value`; the others require a finite number (0–100 for percentages).
Percent interpolates min/max; percentile interpolates sorted numeric samples at
`(count-1)*value/100`. Resolved anchors must be nondecreasing. Values clamp outside
the anchors; intervals linearly interpolate RGB channels, rounded to nearest
integers. Equal anchors select the first colour at the shared value, including
constant ranges. A range with no numeric cells receives no scale fill; only
structural anchor validation and explicit numeric-anchor order apply in that case.

`MAX_RULES = 100` and `MAX_RANGE_CELLS = 1_000_000` are inclusive. Limits are
checked before rule/cell traversal, sorting or output allocation. Row metadata
establishes rectangular shape before processing values. `[]` is an empty range;
nonempty ranges require nonempty rows. Sparse arrays, nonfinite numbers,
non-data objects/accessor properties, and unknown fields are rejected.

All rejected inputs throw `ConditionalFormatError` with a machine-readable code:

| Code | Meaning |
| --- | --- |
| `INVALID_RULE` | Malformed rule/style/anchor, reversed bounds/anchors, invalid count/colour, or too many rules |
| `INVALID_RANGE` | Malformed/ragged/sparse range or unsupported cell value |
| `RANGE_TOO_LARGE` | More than one million cells, or a dimension exceeding that limit |

The library is pure TypeScript with no engine, React, hooks, I/O or dependencies.
See root `QUESTIONS.md` for the conservative choices where the brief is silent.
