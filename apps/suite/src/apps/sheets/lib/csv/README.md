<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CSV/TSV core (SHT-L4)

Pure TypeScript, no I/O or dependencies. Import from `./index`:

```ts
const delimiter = sniffDelimiter(source);
const rows = parseCsv(source, { delimiter });
const columnTypes = inferColumnTypes(rows.slice(1)); // caller chooses whether a header exists
const csv = serializeCsv(rows, { delimiter });
```

`parseCsv` sniffs comma, semicolon and tab by default. Each candidate must parse the whole input
as a rectangular table with more than one column. Multiple candidates throw `CsvError` with
`code: 'delimiter'`; supply a delimiter to resolve the ambiguity. With no unquoted separators,
sniffing returns comma. Malformed syntax and ragged records fail; there is no padding, trimming,
blank-line skipping or fallback that hides a parse error.

Quotes must start a field, double quotes escape quotes, and a closing quote must be followed by
a delimiter, a record terminator or EOF. CRLF and LF record terminators are supported (including
mixed files); bare CR outside quotes is rejected. Embedded CR/LF is preserved inside quotes.
One leading U+FEFF file BOM is removed; content BOMs are preserved. Unicode and tabs are accepted;
other ASCII controls (including NUL and DEL) are rejected. Empty input is `[]`, a blank record is
`['']`, and a final record terminator adds no extra record. Empty fields are always retained.

`serializeCsv` defaults to comma and CRLF, terminates every record, and supports `lineEnding: '\n'`
and `bom: true`. It accepts rectangular string tables; zero-cell rows cannot be represented and
throw. Formula-like strings stay literal strings; the library does not evaluate them or add
apostrophes. Consumers choose any spreadsheet-execution policy separately.

`inferColumnTypes` returns metadata only; it never converts or rewrites cells. There is no
header guessing. Empty cells do not vote; all-empty columns and mixed columns are `text`.
Supported lexical types:

- `number`: `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`, finite, absolute value at most
  `Number.MAX_SAFE_INTEGER`, and no nonzero value underflowing to zero. Leading-zero identifiers,
  leading plus, whitespace, thousands separators and locale decimals remain text. Metadata is
  not a guarantee of exact decimal-to-binary conversion; the original decimal text is retained.
- `boolean`: exactly `true` or `false` (lowercase).
- `date`: valid Gregorian `YYYY-MM-DD`, years 0001–9999, including Gregorian leap-year rules.
  Datetimes, offsets and ambiguous local dates remain text.
- `text`: everything else, including formula-like input.

`CSV_LIMITS` is frozen: 10,000,000 UTF-16 code units (including a file BOM), 100,000 cells,
100,000 rows and 16,384 columns. Limits apply to parse, sniff, inference and serialisation;
serialised output counts escaping, delimiters and terminators too. Sniffing examines the entire
bounded input in three linear passes. Row count is inherently bounded by the cell count while
parsing. No partial results are returned on failure. `CsvError` codes are `syntax`, `delimiter`,
`shape`, `limit` and `invalid-input`; messages do not echo input contents.
