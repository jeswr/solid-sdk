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

Shared formula masters are kept. Dependents keep their cached values without
formulas; relative references are not expanded. Formula text is preserved even
when Excel cannot evaluate it. Excel recalculates formulas when opening exports.
Sheet names on export are limited to 31 characters, stripped of Excel-invalid
characters and leading/trailing apostrophes, and made nonempty and unique.

Chartsheets and dialogsheets are ignored. Charts, images, comments, validation,
conditional formatting, pivot tables, macros and external links are not carried
over. Macro-enabled files (.xlsm) are rejected. Font styling, fills, rich text
formatting, hidden state, print settings and other workbook metadata are omitted.
The 1904 date system is not supported; those workbooks are rejected.

Import rejects DTDs, malformed XML, unsafe relationship targets, duplicate cell
references and ZIP entries, and files over these limits: 1,000 ZIP entries,
20 MiB per entry, 100 MiB total uncompressed, 200 worksheets, 100,000 rows,
16,384 columns and 2 million cells or occupied grid positions. Only workbook
metadata and referenced worksheets are extracted. Sheet IDs are generated.
