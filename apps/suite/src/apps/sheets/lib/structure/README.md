<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Structural edit plans

`planStructureEdit(sheets, edit)` is a synchronous, engine-independent data-only
operation. It returns `{ sheets, changes }` without mutating its inputs. All
coordinates are one-based positive safe integers; sheet lookup ignores case.
Missing cells are blank. Values are strings, finite numbers, booleans or null;
formula cells contain a formula beginning with `=` and optional `notation`
(`A1`, the default, or `R1C1`). Values beginning with `=` remain literal values.

```ts
import { planStructureEdit } from "./index";

const plan = planStructureEdit(
  [{ name: "Plan", cells: [
    { row: 1, column: 1, formula: "=$B$3" },
    { row: 3, column: 2, value: 8 },
  ] }],
  { kind: "insert", sheet: "Plan", axis: "row", index: 3, count: 2 },
);
// Formula becomes =$B$5; value moves to B5. Changes list A1, B3 and B5.
```

Insert/delete edits use `{ kind, sheet, axis: 'row' | 'column', index, count }`.
Insertion is before `index`; deletion removes `count` coordinates starting there.
Absolute markers survive, but do not prevent structural shifts. Ranges expand
on interior insertions and contract on partial deletion; entirely deleted targets
become `#REF!`, whether or not those target cells were populated.

Moves use `{ kind: 'move', source: { sheet, start, end }, destination:
{ sheet, row, column } }`, with inclusive rectangular source and top-left
destination. They cut from a snapshot, so overlapping moves are safe. Destination
contents are overwritten, including by blank source cells. References fully
inside the source follow it regardless of absolute markers. Disjoint targets
remain fixed, including targets in the overwritten destination. Moved formulas
retain their resolved targets, with updated R1C1 offsets and sheet qualification
when needed. An identical source/destination is a validated no-op.

Each change has `{ sheet, row, column, before, after }`, where before/after are
cell data without coordinates, or null for an absent cell. The list contains all
and only addresses whose data differs, in input sheet order then row/column order.
The output cells are also sorted by row/column. Snapshot and change records do
not share mutable input objects. This API does not evaluate formulas.

The formula dialect matches `../refs`: cell and rectangular/whole-axis references,
quoted sheet names with doubled apostrophes, numbers, strings with doubled quotes,
booleans, standard error literals, operators, parentheses and comma-separated
function calls. Exported `MAX_FORMULA_LENGTH` (8,192 UTF-16 units) and
`MAX_FORMULA_TOKENS` (512) bound formula syntax, including rewritten output length. Existing
source text is preserved outside rewritten references; rewritten sheet qualifiers
are quoted. All qualified sheets must exist in the input workbook.

Exported limits are `MAX_SHEETS` (256), `MAX_CELLS` (100,000 populated cells across
the entire workbook, including explicit nulls and formulas), `MAX_SHEET_NAME_LENGTH`
(256 UTF-16 units, including edit and reference sheet names), and
`MAX_CELL_VALUE_LENGTH` (32,768 UTF-16 units per string value). An early preflight
checks sheet count before reading sheets, aggregate cell count before reading cells,
and all input lengths before validation scans, lowercasing, materialisation, sorting
or serialisation. Oversize workbook data or edit names throw `invalid-edit`;
formula length/token excesses retain `unsupported`. One case-insensitive name index
is built per call and reused for reference validation, edits and output placement;
lookups do not rescan the workbook.

Sheets, cells, edits, move sources/destinations and move endpoints must be records.
Primitives and arrays (including arrays carrying valid record fields) are rejected
before field enumeration, so malformed strings or arrays cannot bypass the size
preflight by materialising their character or element keys. The field validator
checks own enumerable fields one at a time and stops at the first unsupported field,
without creating a key array. Each record schema allows at most five fields, so at
most six own fields are inspected, regardless of how many extra fields a record has.
These failures use `SheetReferenceError` with `unsupported` and a fixed message
without caller data.

Unsupported or malformed input throws the exported `SheetReferenceError`, with
`syntax`, `bounds`, `unsupported` or `invalid-edit` codes, before any result is
returned. This includes moves splitting a referenced range, named/structured/3D/
external references, intersections/unions, array/spill syntax, reversed ranges,
duplicate sheets or cell addresses, and unknown model fields. Formatting, dates
as objects, dimensions, merged cells and engine-native metadata need an adapter;
they are not silently discarded. Every input formula is validated even if the
edit would delete or overwrite its cell. See root `QUESTIONS.md` for the
conservative choices where SHT-L5 does not define a policy.
