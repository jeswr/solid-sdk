<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Excel files

`readXlsx` and `writeXlsx` run in the browser without loading Univer.

Both directions preserve worksheet order and names, numbers, text, booleans,
formulas and their cached values, cell number formats (including date/time formats),
merged cells, frozen panes, column widths and row heights. Import reads shared
strings and inline strings and joins rich text runs into plain text. Rows without
`r` follow the previous row (starting at 1); cells without `r` follow the previous
cell in their row (starting at column A). Duplicate positions are rejected. Errors and
ISO date strings become text. Booleans accept `1` and `TRUE`. Export uses inline strings. Dates stored as Excel
serial numbers keep their number format. Width conversion is approximate:
Excel characters × 7 + 5 pixels; row points × 96/72 pixels.
Number formats include built-in IDs 0–4, 9–22, 37–40 and 45–49 and custom
`numFmt` codes. Other built-in IDs and inherited row/column formats are omitted.

Import turns an Excel shared formula (a formula filled down or across) into one
Univer formula group (`si`), so every cell keeps its formula; a cell outside the
group's range keeps only its cached value. Export does the reverse when the group's
first cell holds the formula; other groups keep their cached values. An array
formula keeps its formula in its first cell, and the cached results in the rest of
its range are dropped so Univer can spill into them. On export, array formulas are
written as ordinary formulas, so Excel shows only their first value. The
`_xlfn.`/`_xlws.` prefixes of newer Excel functions are removed on import and added
back on export (outside string literals and quoted sheet names). LET/LAMBDA
parameter names (`_xlpm.`) and defined names are not carried over.
Formula text is preserved
even when Excel cannot evaluate it, and formulas that refer to a renamed sheet are
not rewritten. Excel recalculates formulas when opening exports. Frozen rows and
columns are the first ones shown from the sheet view's top-left cell, as in Excel.
Sheet names on export are limited to 31 characters, stripped of Excel-invalid
characters and leading/trailing apostrophes, and made nonempty and unique. Cell
text is cut to Excel's 32,767-character limit, widths to 255 characters and
heights to 409 points; number formats over 255 characters and NaN or infinite
numbers are left out.

Chartsheets and dialogsheets are ignored. Charts, images, comments, validation,
conditional formatting, pivot tables, macros and external links are not carried
over. Macro-enabled files (.xlsm) are rejected. Font styling, fills, rich text
formatting, hidden state, print settings and other workbook metadata are omitted.
Cell hyperlink relationships are also omitted in both directions. Their visible labels
remain plain text; Univer's internal hyperlink delimiters are stripped on export. Imported
hyperlink targets, including unsafe schemes, are never turned into clickable links.
The 1904 date system is not supported; those workbooks are rejected.

Import rejects DTDs, malformed XML, unsafe relationship targets, duplicate cell
references, rows and ZIP entries, worksheets that share a part, overlapping column
ranges or merged cells, and files over these limits: 50 MiB compressed (also checked
before the sidebar reads a file), 1,000 ZIP entries, 20 MiB per part and 100 MiB in
total inflated (counted as the bytes inflate, since the sizes a ZIP declares can't
be trusted), 2 million `<` delimiters per decoded XML part (checked before DOM
parsing), 200 worksheets, 100,000 rows, 16,384 columns, 2 million cells or occupied
grid positions (row heights and merges count as cells), 10,000 merges per workbook,
and 20 million characters of cell text and formulas (a shared string counts once
per cell that uses it).

The workbook part is resolved from the package's `officeDocument` relationship in
`_rels/.rels`; worksheets, shared strings and styles are resolved relative to that
workbook through its relationships. Transitional and strict relationship types are
accepted. Conventional workbook, strings and styles paths are used only when the
corresponding relationship is absent and the conventional part exists; an explicit
missing or unsafe target is rejected. Only content types, package/workbook
relationships and resolved workbook, strings, styles and worksheet parts are
inflated, so media and unreferenced conventional parts don't count. Discovery and
part extraction share one inflated-byte budget; each selected part is inflated
once.

Empty rows past the row limit and one-cell merges are skipped. Elements are read
only at their schema positions (cells in `sheetData` rows, and so on), so nesting
can't multiply the work. Sheet IDs are generated.
