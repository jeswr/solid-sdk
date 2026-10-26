<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Exact money and spending reports (MON-L5)

Import the public API from `./index`. This directory is pure TypeScript: no React, hooks,
RDF, I/O, clock, locale inference or third-party dependencies. Inputs are never mutated.

`Money` is `{currency, minor}` with signed **safe integer minor units**. It is structurally
compatible with the existing budget library for its supported currencies. All amount
calculations use bigint intermediates and check the safe-integer boundary before returning.
`parseMoney(currency, decimalText)` and `formatMoney(amount)` provide exact decimal boundaries.
No numeric decimal inputs, exponents, separators, whitespace, leading plus/zeroes or rounding
are accepted. Fractional precision cannot exceed the currency's exponent, even for trailing
zeroes. Negative zero is normalised to zero. Decimal strings are limited to 1024 characters.
`money` constructs minor-unit values; `addMoney`/`subtractMoney` require identical currencies;
`multiplyMoney` accepts signed safe integer multipliers only. Unsafe results throw `overflow`.

## Currencies and supplied rates

`MINOR_UNITS` pins every numeric `CcyMnrUnts` entry in SIX ISO 4217 List One published
2026-09-17, retrieved 2026-10-26:
[official source XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml).
The table includes exponents 0, 2, 3 and 4; there is no default exponent. Historical, unknown,
lowercase and N.A. entries (including metals, testing and no-currency codes) fail closed.
Currency changes require an explicit reviewed table update, never runtime lookup or locale data.

`convertMoney(amount, targetCurrency, rates)` takes a table of `{from, to, rate}` where `rate`
is **target major units per source major unit**, supplied as positive decimal text. For example,
`{from: 'EUR', to: 'USD', rate: '1.25'}` converts EUR 4.00 into USD 5.00. Scaling uses both
currencies' ISO exponents. Fractional target minor units throw `inexact-conversion`; even two
inexact entries that would cancel when summed are rejected individually. Only a supplied direct
rate is used: no inversion, cross rates, default rates or fetching. Zero foreign amounts still
require a rate. Same-currency conversion needs no rate and returns a fresh amount.

All table entries, including unused ones, are validated. Duplicated ordered pairs, self rates,
malformed/nonpositive decimals, unsupported currencies and sparse tables are rejected. Rates
are scoped to one call; callers select the appropriate dates/provenance themselves. Reports
apply one supplied table to both periods; callers needing historical rate schedules must
convert entries explicitly first.

## Transactions, periods and reports

Transactions have unique opaque `id`, civil `date`, signed `amount: Money`, explicit `kind`
(`income`, `expense`, `transfer`) and `categoryId` (string or null). IDs/categories are nonempty
strings without outer whitespace. Only expenses can have a nonnull category. Negative expenses
mean spending; positive expense refunds reduce spending. Negative income reversals reduce
income. Transfers never contribute to reports; kinds are supplied, never inferred from signs.

Every report requires a `{start, end}` inclusive Gregorian `YYYY-MM-DD` period (years 0001–9999)
and `{currency, rates?}` options with explicit target currency. Timestamps/timezones are rejected.
All rows, periods, options and rates are validated, including empty and out-of-range inputs.
Selected non-transfer rows must be exactly convertible into the target; mixed currency reports
without the needed rates throw. Excluded rows need valid amounts/currencies, but no FX rate.

- `incomeExpenseTotals(transactions, period, options)` returns `{income, expense, net}` as
  `Money` values, with `net = income − expense`. Expense is net spending, possibly negative
  after refunds. Empty input gives explicit target-currency zeros.
- `spendingByCategory(...)` returns `{categoryId, total: Money}[]`, in ascending UTF-16 ID
  order with uncategorised null last. Only occupied expense categories are emitted. Categories
  are exact opaque keys, with no implicit hierarchy, aliases or currency grouping.
- `spendingByMonth(...)` returns `{month: 'YYYY-MM', total: Money}[]`, sorted ascending.
  Months without expenses are absent; explicit zero expenses preserve their bucket.
- `comparePeriods(transactions, previousPeriod, currentPeriod, options)` compares income,
  expense and net independently. Each result has `{previous, current, change, percentage}`.
  `change = current − previous`; percentage is the reduced exact fraction
  `100 × change / abs(previous)`, represented by decimal integer string numerator and positive
  denominator. A zero previous value gives null, including zero-to-zero. Nonzero-to-unchanged
  gives `0/1`. Periods must be disjoint with previous before current; unequal lengths are allowed
  without normalisation. Callers choose periods explicitly.

All rejected supported-shape inputs raise `ReportsError` with stable `code` (exported union),
without echoing financial input values. Codes distinguish invalid input, currency, amount,
rate, missing rate, precision, date, period, duplicates, mismatch and overflow. Totals must
remain within safe integers throughout accumulation; a later cancellation does not rescue
an earlier overflow. These choices are recorded in the lane's root `QUESTIONS.md`.

`money-reports-arithmetic.test.ts` and `money-reports.test.ts` import the public barrel. The
app's Vitest configuration enforces 100% statements, branches, functions and lines per file
for this directory, including zero-line type/barrel files. Fixtures are synthetic example.org
transactions. There are no rendered states, screenshot fixtures or browser tests in this lane.
