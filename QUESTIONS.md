<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# SHT-L5 questions

1. SHT-L5 / `specs/apps/13-pure-libraries-5.md` specifies moving ranges but does not
   define references that intersect only part of the moved rectangle. Options:
   model engine-specific unions, retain the original rectangle, or reject the edit.
   Conservative implementation: reject with typed `unsupported` before returning
   a plan. Fully contained references follow the moved cells; disjoint references
   retain their targets. Whole-row/column references intersecting a finite move are
   also rejected. An identical source/destination is a validated no-op.
2. The same specification does not prescribe a workbook/plan schema. Options:
   engine-native snapshots or an engine-independent sparse cell model. Conservative
   implementation: one-based sparse data/formula cells, case-insensitive sheet
   names, and an immutable result snapshot plus sorted address-level before/after
   changes. Moves use cut semantics, including destination overwrite and blank
   source cells clearing their corresponding destination cells. No dimensions,
   formatting, merged cells, named ranges, external workbooks, or engine state are
   interpreted by this data-only API; unsupported fields/syntax are rejected.
