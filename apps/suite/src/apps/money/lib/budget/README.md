<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Money budgets and reports

Import from `./index`. Pure TypeScript: no React, RDF, I/O, system clock or new dependencies.
Inputs and previous output snapshots are never mutated. All monetary numbers are signed safe
integer minor units; calculated intermediate values outside that range throw `BudgetError`.
Decimal boundaries use strings (`parseMoney` / `formatMoney`) without floating-point scaling,
rounding or locale inference. Multiplication accepts integer factors only. `addMoney` and
`subtractMoney` require identical currencies; `groupMoney` returns a separate total per currency.

`MINOR_UNITS` is a frozen ISO 4217 subset: AUD/CAD/CHF/EUR/GBP/USD = 2, JPY = 0, KWD = 3.
Source: [SIX ISO 4217 List One XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml),
verified 2026-10-26. Unsupported codes, including historical currencies, fail closed.

## Envelopes

`calculateBudget(months, opening)` accepts consecutive, ascending `YYYY-MM` months and an
explicit opening pool (`availableToBudget: Money[]`) plus opening envelopes
(`{categoryId, amount: Money}[]`). For a fresh budget pass both opening arrays empty.
Each month supplies `income: Money[]`, `assignments: Allocation[]` and `activity: Allocation[]`.
Assignment totals are unique per category/currency/month. Repeated activity entries are summed.
Category IDs are opaque, exact, nonblank strings without outer whitespace.

- `rollover` = the previous month's signed envelope available, or the explicit opening amount.
- `available` = rollover + assigned + activity. Spending is negative; refunds are positive.
- `availableToBudget` = previous unassigned pool + net income − assignments.
- Negative assignments release money back to the pool. Overassignment makes the pool negative.
- Overspend stays negative in its envelope next month until covered. It is never erased or
  additionally deducted from the pool. This is ordinary cash-envelope budgeting, without
  implicit credit-card/debt conversion. Callers provide net cash activity, excluding transfers
  between budget accounts; uncategorised income belongs in `income`, not envelope activity.

Output is grouped by currency with integer fields (`assigned`, `activity`, `rollover`,
`available`). All existing envelopes persist through months with no assignments/activity,
including zero envelopes. New categories/currencies start at zero. Currency and category
ordering is ascending UTF-16. `[]` months returns `[]` after validating the opening state.
When continuing a calculation in a new call, map the final output's pool and envelope available
back to the opening structure; the caller owns the boundary date of that opening snapshot.

## Reports

Transactions have unique `id`, civil `date`, signed `amount: Money`, `kind` (`income`, `expense`,
`transfer`) and explicit `categoryId` (null for uncategorised expenses and all other kinds).
Expense refunds use positive amounts; income reversals use negative amounts. Transfer
classification is supplied by the caller; this library does not infer or match transfers.
Periods have inclusive `{start, end}` Gregorian `YYYY-MM-DD` civil dates, years 0001–9999.
Timestamps/timezones must be converted by the caller; there is no implicit timezone or FX rate.

- `spendByCategory(transactions, categories, period)` takes a tree of `{id, parentId: string|null}`.
  Positive output means net spending (negated expense activity). Refunds reduce spending, even
  below zero. `direct` includes only the category's own activity; `total` adds every descendant
  once, including activity posted directly to parents. Do not sum rolled-up rows as a grand
  total. Only occupied categories and their ancestors are emitted, grouped by currency, sorted
  by category ID, with uncategorised (`null`) last. Income and transfers are excluded.
  Duplicate categories, missing parents, cycles and unknown transaction categories are errors.
- `cashFlowByMonth(transactions, period)` returns occupied non-transfer month/currency buckets,
  sorted by month then currency. `inflow` and `outflow` are nonnegative magnitudes; `net` is signed.
  Refunds count as cash in, income reversals as cash out. Zero transactions preserve a zero
  bucket; missing months are absent rather than fabricated as zero.
- `netWorthSeries(balances, sampleDates)` takes `{accountId, date, balance: Money}` snapshots.
  Assets are positive; liabilities are negative. At each unique sample date (sorted ascending),
  it sums the most recent balance on/before that date for every supplied account, by currency.
  Every account needs a baseline before the first requested sample; missing balances throw
  instead of implying zero. Supply explicit zero snapshots for pre-opening/closed accounts.
  A currency change within an account or two balances for the same account/date is ambiguous
  and rejected. No samples returns `[]`; no accounts returns points with `totals: []`.

All inputs, including excluded/out-of-range rows, are validated before returning a report.
Malformed objects, sparse arrays, unsupported amounts/dates/kinds, duplicates and unsafe
arithmetic throw `BudgetError` with a stable `code`. Messages never include caller values.
An empty report does not bypass validation. See `QUESTIONS.md` for the conservative readings.

Tests import the public barrel. `pnpm --filter @jeswr/app-suite run test` enforces 100% statements,
branches, functions and lines for every TypeScript file in this directory.
