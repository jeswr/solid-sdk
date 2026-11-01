<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Money transfers and splits (MON-L6)

Pure TypeScript with no I/O, hooks, React, RDF writes or new dependencies. Import
from `index.ts`. `MoneyTransaction` is the existing Money rules DTO: signed safe
integer `amount` in currency minor units, strict Gregorian `YYYY-MM-DD` (years
0001–9999), account/id strings, uppercase three-letter currency code, payee,
memo, status and optional category. The caller supplies the currency's minor
units; no decimal parsing, precision inference, currency registry lookup or FX.

`detectTransfers(transactions, { accountIds, maxDays })` requires at least two
distinct financial account IDs owned by the user and an explicit nonnegative
safe integer day window. Out-of-scope transactions are errors. Candidates have
distinct accounts, identical currency, equal and opposite nonzero amounts, and
an inclusive absolute calendar-day gap within `maxDays`. All statuses participate;
the caller supplies entries eligible for transfer detection. Same-account or
cross-currency entries and zero amounts do not match.

The result contains `pairs` of `{ outflowId, inflowId }` only when both entries
have exactly one candidate. `ambiguous` reports `{ transactionId, candidateIds }`
for every other entry with candidates, including an entry whose sole candidate
has competing candidates. `unmatchedIds` contains entries with no candidates.
Unique pairs remain available alongside ambiguities. Pair order follows outflow
input order; ambiguity, unmatched and candidate order follow transaction input
order. Reordering cannot change which pairs qualify. No nearest-date choice,
global assignment, greedy consumption or elimination of competing candidates.
The previous two-account `rules/detectTransfers` API is unchanged.

`splitTransaction(transaction, parts)` returns independent copies of the original
transaction and at least two `{ categoryId, amount }` parts. Parts inherit the
original currency and use signed safe integer minor units. Their sum must equal
the original amount exactly; BigInt summation avoids rounding even when
intermediate sums exceed the safe integer range. Credits, zero parts, repeated
categories and offsetting signed parts are allowed. No automatic balancing,
rounding, part IDs, nested splits or transaction mutations.

`mergeSplit(split)` / `unsplitTransaction(split)` revalidate the original and all
parts, then return a fresh copy of the complete original transaction, including
its category (or the absence of one). They reverse one split; they do not merge
unrelated ledger entries or infer a replacement category. Split parts supplement
one ledger transaction; do not count both original and parts as ledger activity.

Malformed inputs throw `TransfersError` with a stable `code` and no input values
in the message. Validation covers every input before returning any suggestions.
Inputs are plain data records (including null-prototype records) and dense plain
arrays, as from JSON. Unknown fields, custom prototypes, accessors, hidden record
fields/array elements, extra array properties, undefined optional categories,
duplicate transaction/account IDs, malformed dates and unsafe/fractional amounts
are rejected. Identifiers must be nonempty and have no surrounding whitespace;
they are opaque and never normalised. Inputs are never mutated.

The scope interpretations are recorded in root `QUESTIONS.md`. Unit tests cover
every file at 100% statements, branches, functions and lines through the suite's
per-file coverage thresholds.
