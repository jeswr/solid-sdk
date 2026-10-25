<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Money statement import (MON-L1)

Pure TypeScript, synchronous and dependency-free. Import from `./index`. All functions accept text or plain objects; none performs I/O, uses React or writes RDF. Parsing fails atomically on invalid input. Error messages never embed statement contents.

```ts
import { importCsv, importOfx, detectDuplicates, categoriseTransactions } from "./index";

const parsed = importCsv(csvText, {
  columns: { date: "Date", description: "Payee", amount: "Amount" },
  dateFormat: "DD/MM/YYYY", // omit only when dates are unambiguous
  currency: "GBP",        // optional; no invented currency default
});
const { unique, duplicates } = detectDuplicates(parsed, existingTransactions);
const categorised = categoriseTransactions(unique, [
  { category: "Groceries", description: { match: "contains", value: "Example Market" },
    amount: { min: "-100", max: "0" } },
]);
const fromOfxOrQfx = importOfx(ofxText);
```

`ImportedTransaction` has `date` (`YYYY-MM-DD`), `amount` (signed canonical decimal string) and `description`. Optional fields are `currency`, `accountId`, `externalId`, `memo` and `category`. Decimal strings preserve all supplied precision: `-12.500` becomes `-12.5`, negative zero becomes `0`. `compareAmounts` compares signed decimals exactly.

CSV supports comma, semicolon, tab and pipe delimiters, BOM, quoted delimiters/newlines/escaped quotes, LF/CRLF/CR and blank physical lines. `sniffDelimiter` requires a unique consistent multi-column interpretation; specify `delimiter` for ties, single-column or empty files. Map columns by exact header name or zero-based index; duplicate named headers are rejected. Use `hasHeader: false` with numeric mappings for headerless files. Map either signed `amount` or unsigned `debit`/`credit` columns (one nonempty direction per row). `decimalSeparator: ","` supports European decimal notation; thousands grouping is validated. Dates support year-first, day-first and month-first formats, four-digit years and slash/dash/dot separators. `sniffDateFormat` returns `null` for ambiguity, mixed formats or invalid dates. Every row must have a valid date, description and amount; malformed or all-empty multi-column rows fail.

OFX/QFX supports 1.x SGML headers with implicit scalar closing tags and 2.x XML, bank and credit-card statements, multiple statements, attributes, comments, CDATA and predefined/numeric character references. `NAME` is the description, falling back to `MEMO`; memo and `FITID` are preserved separately. Statement currency and account ID stay scoped to their statement. The posting date retains the bank's calendar day; an OFX time/offset suffix does not shift it. Input must already be decoded to a JavaScript string; file charset conversion is the caller's responsibility. DTDs/custom entities, malformed nesting, nested/duplicate scalar fields and incomplete records are rejected. This is an OFX subset reader, not a general XML parser or a bank connection.

`transactionHash` hashes the date, exact normalised amount and description (NFKC, trimmed/collapsed whitespace, lowercase) with non-cryptographic FNV-1a. `detectDuplicates` compares against existing records and earlier incoming records, verifies hash collisions against the full tuple and returns ordered `unique` and `duplicates` arrays with the original objects. Scope each call to **one account and currency**. Matches are candidates for review: two legitimate identical purchases can share a tuple. No transaction is automatically persisted or deleted.

Rules use literal `contains`, `equals`, `startsWith` or `endsWith` description matching (case-insensitive by default; optional `caseSensitive: true`) and optional inclusive signed amount bounds. Both predicates must match; the first matching rule wins. Existing categories are preserved, every result is a new object, and invalid/empty rules fail even for empty input. Scope amount rules to one currency. Matcher text is never interpreted as a regular expression.

Synthetic fixtures and unit tests live under `apps/suite/test/`. The app's ordinary Vitest run enforces 100% statements, branches, functions and lines for every source file in this directory, including the barrel. No coverage exclusions or ignore markers are used.
