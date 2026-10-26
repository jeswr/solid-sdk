<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-qjiw interpretation questions

1. SHT-L4 / specs/apps/12-pure-libraries-4.md does not specify numeric limits. Options:
   caller-configured limits or fixed library limits. Conservative implementation: at most
   10,000,000 UTF-16 code units, 100,000 cells/rows and 16,384 columns; no unbounded option.
2. SHT-L4 does not define the inference grammar, header detection or coercion. Options:
   permissive locale/date parsing or a narrow lexical subset. Conservative implementation:
   preserve all parsed strings; infer metadata separately over caller-selected data rows,
   ignoring empty cells. Numbers use decimal/scientific syntax without leading zeroes or
   locale separators; booleans are exactly true/false; dates are real YYYY-MM-DD Gregorian
   dates (years 0001–9999). Other values and mixed columns are text. No automatic headers.
3. SHT-L4 does not prescribe delimiter tie-breaking or ragged-row handling. Options:
   guess/pad or reject. Conservative implementation: reject multiple plausible delimiters
   and inconsistent row widths; allow an explicit delimiter to resolve ambiguity. Sniffing
   defaults to comma only when there are no unquoted candidate separators.
