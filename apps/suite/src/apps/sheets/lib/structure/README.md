<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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
function calls. Syntax is limited to 8,192 characters and 512 tokens. Existing
source text is preserved outside rewritten references; rewritten sheet qualifiers
are quoted. All qualified sheets must exist in the input workbook.

Unsupported or malformed input throws the exported `SheetReferenceError`, with
`syntax`, `bounds`, `unsupported` or `invalid-edit` codes, before any result is
returned. This includes moves splitting a referenced range, named/structured/3D/
external references, intersections/unions, array/spill syntax, reversed ranges,
duplicate sheets or cell addresses, and unknown model fields. Formatting, dates
as objects, dimensions, merged cells and engine-native metadata need an adapter;
they are not silently discarded. Every input formula is validated even if the
edit would delete or overwrite its cell. See root `QUESTIONS.md` for the
conservative choices where SHT-L5 does not define a policy.
