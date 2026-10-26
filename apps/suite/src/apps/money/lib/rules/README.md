<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Money rules (MON-L3)

Pure TypeScript: import `applyRules`, `detectTransfers`, `reconcile`, `MoneyRulesError`
and their DTO types from `index.ts`. No persistence, network, hooks, dependencies or
RDF model changes. Map the data layer's monetary decimals to integer minor units
before calling; this library never converts or rounds amounts.

All amounts, balances, range bounds and priorities are safe integers. Dates are
strict Gregorian `YYYY-MM-DD`, years 0001–9999. IDs are nonblank opaque strings;
currency codes are exactly three uppercase ASCII letters (no currency registry
lookup or conversion). Text is used exactly as supplied, without case folding,
trimming or Unicode normalization. Inputs are plain data records/arrays, as from
JSON; accessor/hidden fields, unknown fields, explicitly undefined optional fields, duplicate transaction
or rule IDs and malformed fields throw `MoneyRulesError` with a stable `code`.
Errors contain no transaction or rule values. All inputs are validated even if
they would not match a rule or fall after a statement cutoff. Inputs are never
mutated; the returned categorisation transaction is a fresh copy.

`MoneyTransaction` is a local, signed-minor-unit DTO, not an RDF transaction or
SDK account. Its account ID identifies a financial account. Status is explicitly
`uncleared`, `cleared` or `reconciled`. Optional category ID is preserved unless
the winning rule replaces it.

## Categorisation

`applyRules(transaction, rules)` returns `{ transaction, matchedRuleId }` (null if
unmatched). Lower numeric priority wins; equal priorities preserve rule input
order. The first matching rule applies its category and/or payee rename and stops.
All conditions are ANDed; `{}` explicitly means unconditional. Account is exact;
amount bounds are inclusive and signed, with at least one of min/max required.
Contains is literal substring matching. Glob matches the whole field with `*`
for zero or more Unicode code points and `?` for exactly one, including newlines.
Other characters are literal, except brackets, braces and backslashes, which are
rejected as unsupported glob syntax. No regular expressions are accepted or
compiled from patterns. Text conditions and actions must be nonempty; renamed
payee/category ID must be nonblank. There is no implicit category clearing.

## Transfers

`detectTransfers(transactions, { accountIds: [a, b], maxDays })` returns
`{ outflowId, inflowId }` pairs in outflow input order. Supply exactly two distinct
financial account IDs and a nonnegative integer calendar-day tolerance. Every
transaction must belong to one of these accounts. Candidates have equal opposite
nonzero amounts, equal currencies, distinct accounts and an inclusive date gap
within the tolerance. Currency codes can differ between separate pairs; there
is no FX matching. If any transaction has multiple eligible counterparts, the
entire call throws `ambiguous-transfer` rather than choosing financial links.
Otherwise each transaction appears in at most one pair. All statuses participate;
the caller supplies only entries eligible for new transfer matching.

## Reconciliation

`reconcile({ accountId, currency, openingBalance, statementBalance, statementDate,
transactions })` requires a complete single-account, single-currency ledger whose
opening balance precedes **all** supplied entries, including reconciled entries.
The caller owns this completeness guarantee. Cleared and reconciled entries
dated on/before the statement date contribute to `clearedBalance`; uncleared and
future entries do not. `difference = statementBalance - clearedBalance`.
`transactionIdsToReconcile` contains only cleared entries through that date, in
input order, when difference is zero; otherwise it is empty. Already reconciled
entries are never returned. No balancing adjustment or transaction subset is
guessed. Summation uses exact integer arithmetic; an unsafe final balance or
difference throws `overflow`, even if all individual inputs are safe integers.

Interpretations requiring maintainer confirmation are recorded in root
`QUESTIONS.md`. Coverage is enforced at 100% per file by the suite Vitest config.
