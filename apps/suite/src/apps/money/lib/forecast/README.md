<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Recurring transactions and forecasts

Import the public API from `./index`. This library has no I/O, React, clock, or
third-party dependencies. It never mutates inputs; returned objects are fresh.
All dates are Gregorian civil `YYYY-MM-DD` in years 0001–9999, with inclusive
range boundaries. Timestamps, time zones, malformed dates, extra object fields,
unsupported recurrence rules, duplicate IDs, and unsafe amounts are rejected with
`ForecastError.code`. Error messages contain no input values. Even excluded rows
are validated. IDs and payees are exact nonempty strings without outer whitespace.

Amounts, opening balances, daily changes, and closing balances are signed safe
integers in minor units. Currency codes are explicit three-letter uppercase strings,
as in the adjacent money rules library; no currency lookup, precision conversion,
rounding, or foreign exchange is performed. Each forecast account has one currency.
Daily totals use exact BigInt accumulation before conversion to safe integers.

- `expandRecurring(templates, {start, end})` returns occurrences sorted by date,
  then template ID (ascending UTF-16). Templates have `id`, `accountId`, `currency`,
  `payee`, `amount`, `startDate`, optional inclusive `endDate`, and `recurrence`.
  Weekly and biweekly schedules repeat every 7/14 days from `startDate`. Monthly
  rules use `{frequency: "monthly", day: 1..31 | "last"}`; `startDate` is their
  lower bound, which need not itself match the selected day. Yearly rules repeat
  the month/day of `startDate`. Short months skip nonexistent numeric days;
  February 29 yearly schedules skip non-leap years. `last` follows actual month
  ends. No business-day adjustments. No occurrences before start or after end.
- `upcomingBills(templates, range)` returns negative occurrences only, in the
  same order. The caller supplies the time window, including what means today.
- `forecastBalances(accounts, templates, transactions, range)` returns a closing
  balance and net change for every day of every supplied account, including idle
  days/accounts, ordered by account ID then date. Accounts are
  `{id, currency, openingBalance}` immediately before `range.start`. Transactions
  are `{id, accountId, currency, payee, amount, date}` with globally unique IDs.
  Templates have their own unique ID namespace. In-range transactions and template
  occurrences both apply; callers remove template occurrences already represented
  by posted transactions. Out-of-range transactions are not applied. Unknown
  accounts and mismatched currencies fail even outside the window. No accounts
  with no activity returns `[]`; an unsupplied balance is never assumed to be zero.
- `detectRecurring(history, {amountTolerance})` returns suggestions, never writes.
  History uses the same transaction shape. Each exact account/currency/payee/sign
  group needs at least three observations; zero amounts are ignored. The largest
  minus smallest amount must be within the caller's nonnegative safe integer
  tolerance. All observations must exactly match the supported schedule with no
  missing valid occurrences or extra dates. No date jitter, fuzzy payees, implicit
  amount clustering, or weekend adjustment. Conflicting history currencies within
  an account are errors. Supported candidates are tried weekly, biweekly, monthly
  last, monthly numeric, yearly; first match wins. Suggestions contain account,
  currency, payee, latest observed amount, first `startDate`, `lastDate`, recurrence,
  and chronological transaction IDs. Results sort by account/currency/payee/amount.
  Caller review and an explicit template ID are required to create a template.

These are plain data unions, not an RDF or RRULE parser; persistence adapters own
translation to `sched:RecurrenceRule`. See root `QUESTIONS.md` for spec ambiguities.
Tests import the barrel and enforce 100% statements, branches, functions, and lines
for the directory through `apps/suite/vitest.config.ts`.
