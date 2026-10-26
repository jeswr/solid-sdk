<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MAI-L4 conservative readings

1. **Grammar and precedence** (11-pure-libraries-3, MAI-L4 task; 07-parity-backlog, Mail/Search):
   the spec lists OR and negation but does not define grouping or precedence. Options are
   Gmail's wider grammar or only the listed subset. Implement the listed subset: whitespace
   means AND, AND binds more tightly than uppercase OR, and `-` negates one adjacent term.
   Reject parentheses, braces, pipes, wildcards, explicit AND/NOT and unknown operators.
   An empty query matches all messages. Quoting makes reserved syntax literal.
2. **Matching and summaries** (same sections): options include Gmail tokenisation/stemming
   or literal summary matching. Use case-insensitive literal substrings without stemming,
   accent folding or cross-field phrase matches. Bare terms search from, to, subject and
   snippet; field terms search only that field. Summaries explicitly supply all fields,
   attachment/unread booleans and integer Unix milliseconds (`dateSent`); no full-body fetch.
3. **Dates** (MAI-L4 before:/after: YYYY-MM-DD): options include provider/local zones,
   inclusive calendar days, or strict comparisons with an explicit fixed zone. Use valid
   Gregorian dates in years 0001–9999 at UTC midnight; before is `<`, after is `>`.
   No timezone inference or permissive Date-parser rollover. Accept whitespace after a
   field colon, including the task's `before: YYYY-MM-DD` notation.

These choices allow implementation to proceed; confirmation is left to the integrator.
