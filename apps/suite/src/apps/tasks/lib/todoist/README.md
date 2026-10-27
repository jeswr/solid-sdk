<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Todoist template CSV import

`parseTodoistCsv(csv, { defaultTimeZone: "Europe/London" })` returns ordered
`sections`, flat `tasks` with local `parentId` / `sectionId` references, and typed
`warnings`. There is no IO, clock, identity lookup, RDF or React dependency.

The barrel exports the types, `TodoistImportError`, `MAX_TODOIST_CSV_BYTES`
(4 MiB of UTF-8, including any BOM) and `MAX_TODOIST_CSV_ROWS` (20,000 data
records, excluding the header). A no-allocation byte count and a record-counting
CSV validation pass precede field construction and semantic parsing. LF and CRLF
record separators, quoted newlines, doubled quotes and one leading BOM work.
Header names and row types are case sensitive. TYPE and CONTENT are required;
other missing columns act as empty. Extra columns are ignored. Duplicate known headers,
unequal row widths and malformed CSV fail with `INVALID_CSV`.

IDs and zero-based integer `orderKey`s use data-record positions, so comments and
skipped records leave gaps. `line` is the one-based physical starting line of a
record, including quoted newlines in earlier records. New sections reset the
indent stack. Empty INDENT means 1; valid levels are 1–4. Notes attach to the last
task in file order, including across sections and skipped rows. Author,
responsible, description and date-language text are retained without resolution.
Priorities range from 1 (highest) to 4 (lowest). Empty or missing PRIORITY defaults
to 1, following [Todoist's CSV format](https://www.todoist.com/help/account-and-billing/security/import-or-export-a-project-as-a-csv-file-in-todoist-YC8YvN).

Dates support Gregorian `YYYY-MM-DD` and `YYYY-MM-DDTHH:mm[:ss[.fraction]]`, up
to millisecond precision, optionally ending in `Z` or `±HH:mm`. An explicit
offset determines the instant. Otherwise the row's IANA TIMEZONE (or the required
default) resolves the wall clock. Due values contain UTC `dateTime` and
`timeZone`; all-day values also contain `kind: "date"` and the original `date`.
Each import constructs at most `MAX_TODOIST_TIME_ZONES` (32) formatters under
ASCII case-folded timezone keys, including the default zone; distinct aliases count
separately. Additional zones fail with `INVALID_TIMEZONE` before construction.
Cached zones remain usable at the limit; due values retain the supplied zone text.
Local dates within two days of the year 1 / 9999 endpoints are unsupported and
rejected; timezone samples outside the supported range also fail with
`INVALID_DATE`. Explicit-offset datetimes remain supported. Invalid calendar values,
unsupported ISO forms, DST overlaps and gaps fail with `INVALID_DATE`.
Natural-language dates are retained verbatim in `dueText` with `UNPARSED_DATE`;
DATE_LANG never triggers interpretation.

Standalone whitespace-delimited `@labels` contain Unicode letters/numbers,
underscores or hyphens; output excludes `@` and preserves case and duplicates.
Code spans, fenced/indented code, bracketed links, autolinks, escapes, email addresses and labels next
to punctuation remain literal. Markdown and internal whitespace are retained;
removing a token also removes one following space. Titles are trimmed and must
remain nonempty. Descriptions and comments are never tokenised.

Durations are positive finite decimal amounts with the exact unit `minute` or
`day`; an empty amount with an empty unit or Todoist's `None` marker means absent.
Decimals that cannot round-trip through
a JavaScript number without precision loss or exponent notation are rejected.
Invalid amount/unit pairs throw
`INVALID_DURATION`. Other fatal codes are `CSV_TOO_LARGE`, `INVALID_INDENT`,
`INVALID_PRIORITY`, `INVALID_TIMEZONE`. Errors expose `code` and `line` without
echoing input data. Recoverable warning codes are `UNKNOWN_TYPE`, `ORPHAN_NOTE`
and `UNPARSED_DATE`.
