<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Excel files

`readXlsx` and `writeXlsx` run in the browser without loading Univer.

Both directions preserve worksheet order and names, numbers, text, booleans,
formulas and their cached values, cell number formats (including date/time formats),
merged cells, frozen panes, column widths and row heights. Import reads shared
strings and inline strings and joins rich text runs into plain text. Errors and
ISO date strings become text. Export uses inline strings. Dates stored as Excel
serial numbers keep their number format. Width conversion is approximate:
Excel characters × 7 + 5 pixels; row points × 96/72 pixels.
Number formats include built-in IDs 0–4, 9–22, 37–40 and 45–49 and custom
`numFmt` codes. Other built-in IDs and inherited row/column formats are omitted.

Import keeps shared formula masters; their dependents keep cached values without
formulas, because relative references are not expanded. Export writes a formula
filled or copied in Univer (one `si` group) as an Excel shared formula when its
first cell holds the formula; other groups keep their cached values. The
`_xlfn.`/`_xlws.` prefixes of newer Excel functions are removed on import but not
added on export, and defined names are not carried over. Formula text is preserved
even when Excel cannot evaluate it, and formulas that refer to a renamed sheet are
not rewritten. Excel recalculates formulas when opening exports. Frozen rows and
columns are the first ones shown from the sheet view's top-left cell, as in Excel.
Sheet names on export are limited to 31 characters, stripped of Excel-invalid
characters and leading/trailing apostrophes, and made nonempty and unique. Cell
text is cut to Excel's 32,767-character limit.

Chartsheets and dialogsheets are ignored. Charts, images, comments, validation,
conditional formatting, pivot tables, macros and external links are not carried
over. Macro-enabled files (.xlsm) are rejected. Font styling, fills, rich text
formatting, hidden state, print settings and other workbook metadata are omitted.
The 1904 date system is not supported; those workbooks are rejected.

Import rejects DTDs, malformed XML, unsafe relationship targets, duplicate cell
references and ZIP entries, overlapping column ranges, and files over these
limits: 1,000 ZIP entries, 20 MiB per part and 100 MiB in total inflated (counted
as the bytes inflate, since the sizes a ZIP declares can't be trusted), 200
worksheets, 100,000 rows, 16,384 columns, 2 million cells or occupied grid
positions, 100,000 merges per sheet, and 20 million characters of cell text and
formulas (a shared string counts once per cell that uses it). Only workbook
metadata and referenced worksheets are inflated, so media doesn't count. Empty
rows past the row limit are skipped. Sheet IDs are generated.
