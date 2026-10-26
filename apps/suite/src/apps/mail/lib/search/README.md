<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Mail search

Pure TypeScript; import `parseQuery`, `evaluateQuery`, `serialiseQuery`,
`SearchQueryError` and the readonly types from `./index`.

```ts
const ast = parseQuery('from:mira@example.org subject:"garden club" -is:unread OR has:attachment');
const canonical = serialiseQuery(ast);
const match = evaluateQuery(ast, {
  from: "Mira Vale <mira@example.org>",
  to: ["noel@example.org"],
  subject: "Garden club",
  snippet: "Fictional meeting notes",
  hasAttachment: false,
  unread: false,
  dateSent: Date.parse("2026-04-03T12:00:00Z"),
});
```

- Whitespace implicitly ANDs terms. Uppercase `OR` separates AND groups; AND
  binds more tightly. A leading adjacent `-` negates one term. Empty input matches
  all. The canonical AST is an OR of AND clauses, with a single empty AND for
  empty input. Grouping and nested negation are outside this grammar.
- Operators are case-sensitive: `from:`, `to:`, `subject:`, `has:attachment`,
  `is:unread`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD`. Whitespace after `:` is
  allowed. Unknown operators/flag values and unsupported punctuation fail closed.
- Bare words and double-quoted phrases are case-insensitive literal substring
  searches. Free text searches from, each to recipient, subject and snippet
  separately. `from:`/`to:`/`subject:` restrict the field. No stemming, accent
  folding, regex, wildcard expansion or searching beyond the supplied summary.
- Quotes preserve whitespace and make reserved syntax literal. Inside quotes,
  only `\"` and `\\` are escapes; unquoted backslashes/embedded quotes fail.
  Empty/blank phrases, explicit `AND`/`NOT`, parentheses, braces, brackets,
  pipes and wildcards are rejected unless quoted. Quote literal colons and leading
  minuses/pluses. Canonical output always quotes values; it preserves AST values/order
  and semantics, rather than the user's original formatting.
- Dates are real Gregorian days, years 0001–9999. Boundaries are UTC midnight;
  `before` is strictly earlier and `after` strictly later. A message exactly at
  the boundary matches neither. Summaries supply integer Unix milliseconds,
  explicit flags and all text fields (empty strings/recipient arrays are valid).
  Missing/mistyped fields and out-of-range dates throw, even for an empty query.
- All malformed source throws `SearchQueryError` with a typed `code` and a
  zero-based UTF-16 `position`; EOF errors may point to `query.length`. Errors
  contain no query/message content. Invalid AST/message errors use position 0.
  Evaluation validates the full AST and summary before boolean short-circuiting.
- No React, hooks, RDF, fetch, clocks, mutation, dependencies or network access.
  Coverage for every TypeScript file here is enforced at 100% in Vitest.

Root `QUESTIONS.md` records the conservative readings of unspecified semantics.
