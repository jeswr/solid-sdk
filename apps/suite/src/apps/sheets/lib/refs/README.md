<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Sheet references

Pure TypeScript; import from `./index`. No workbook engine, I/O or dependencies.

- `parseA1(text)` / `formatA1(ref)` and `parseR1C1(text, origin)` / `formatR1C1(ref, origin)` convert through one immutable model. Coordinates and origins are **one-based positive safe integers**. `rows`/`columns` each contain inclusive `start`/`end` axes with `{ index, absolute }`; `null` means the entire dimension. At least one dimension must be constrained. R1C1 relative offsets resolve against the explicit origin. Bare `R`/`C` axes mean offset zero inside a cell or whole-axis range. Formatting uses uppercase letters, quotes sheet names and doubles embedded apostrophes. Equal endpoints canonicalise to a cell; reversed ranges fail closed.
- `shiftReference(ref, edit, formulaSheet)` applies `{ sheet, axis: 'row' | 'column', kind: 'insert' | 'delete', index, count }`. Insertion is **before** `index`; deletion removes `count` positions starting there. Both absolute and relative targets move. Insertion inside a range expands it; deletion contracts it around surviving targets, returning `null` only when all targets disappear. An edit perpendicular to a whole-axis range leaves that range intact. Unqualified targets resolve against `formulaSheet`; sheet comparisons ignore case.
- `shiftFormula(formula, edit, context)` rewrites formula reference tokens, producing `#REF!` for deleted targets. Context is `{ sheet, notation?: 'A1' }` or `{ sheet, notation: 'R1C1', origin }`. The R1C1 origin is its **pre-edit** position and moves with the formula sheet, including when the target is on another sheet. A deleted R1C1 formula origin is an error. Strings (including escaped `""`) and source text outside reference tokens remain verbatim; unchanged references also remain verbatim. Changed references use canonical formatting.
- `intersectRanges(a, b)` returns an absolute reference or `null`. `unionRanges(a, b)` returns one absolute rectangle when exact, otherwise two rectangles (which may overlap). It never fills holes. Qualification is explicit: local references share a scope, but local and qualified references do not. Qualify local references before comparing them to qualified targets.

Examples:

```ts
const ref = parseA1("'Dana''s plan'!$B3:D$8");
formatR1C1(ref, { row: 4, column: 3 }); // 'Dana''s plan'!R[-1]C2:R8C[1]
shiftFormula('=SUM(A1:A4)&"A3"', {
  sheet: 'Plan', axis: 'row', kind: 'insert', index: 3, count: 2,
}, { sheet: 'Plan' }); // =SUM(A1:A6)&"A3"
```

The supported formula dialect requires `=` and includes numbers with decimals/exponents, booleans, double-quoted strings, rectangular references, quoted/unquoted sheet names, ordinary function calls (including zero-argument calls), parentheses, commas between arguments, arithmetic, comparisons, concatenation and postfix percent. Function names that look like references are rejected as ambiguous intersections, except the built-ins `LOG10`, `ATAN2` and `DAYS360`. Supported existing error tokens are `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?`, `#NUM!` and `#NULL!`.

Names, arrays, omitted arguments, locale separators, external workbooks, 3D/structured references, dynamic spill, implicit intersection and reference union/intersection operators are rejected. Limits are 8,192 UTF-16 code units and 512 non-whitespace formula tokens; this bounds parsing work and recursion. Strings containing reference-like text are literal, including arguments to `INDIRECT`; this library does not evaluate functions. All rejected inputs within the TypeScript API's types throw `SheetReferenceError`, with `code` equal to `syntax`, `bounds`, `unsupported` or `invalid-edit`. No partial output is returned.
