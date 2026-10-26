<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Investment lots and cost basis (MON-L7)

Import `computeHoldings`, its DTO types, limits and `HoldingsError` from `./index`.
One call handles one security, with no I/O, hooks, React or dependencies:

```ts
computeHoldings(
  [{ id: "example-buy", date: "2026-01-01", kind: "buy",
     quantity: "2.5", price: "10.00", fee: "0.50", currency: "USD" }],
  { method: "fifo", currency: "USD", minorUnits: { USD: 2 }, currentPrice: "12.00" },
);
// quantity: "2.5", costBasis: "25.50", marketValue: "30.00",
// unrealisedGain: "4.50", one open lot, no realised gains.
```

Use `method: "fifo"` for acquisition lots, or `"average"` for one weighted average
pool. The pool retains its first acquisition's ID/date until fully liquidated;
the next buy then starts a new pool. Transactions are validated, copied and sorted
by Gregorian `YYYY-MM-DD`, then ascending UTF-16 ID. IDs must be unique and
nonempty without surrounding whitespace. Input ordering and locale have no effect;
inputs are never mutated. Empty input returns zeros in the explicit currency.

Every transaction has `id`, `date`, `kind`, `quantity`, `price`, `fee`, `currency`.
All decimal values are canonical **nonnegative strings**, e.g. `"0"`, `"0.01"`,
`"2.5"`. Numbers, signs, exponents, separators, leading integer zeroes, omitted
fields and whitespace are rejected. Quantities allow eight decimal places;
prices and fees allow the supplied currency's minor-unit precision, including
trailing zeroes. Precision is never inferred. Every table entry is validated;
currency keys are uppercase three-letter codes, and exponents are integers from
zero through `MAX_CURRENCY_MINOR_UNITS` (30). There is no ISO lookup or FX.

- Buys/sells require positive quantity. Buy fees add to basis, sale fees reduce
  proceeds. A zero price is valid; sale fees can exceed gross proceeds, producing
  negative proceeds. A sell exceeding quantity available at that point fails.
- Splits additionally require `ratio: "n:m"` with positive canonical integer
  components. `n:m` means new quantity = old quantity × n/m. Their quantity, price
  and fee must be zero. Every open lot must remain representable at eight quantity
  decimals; otherwise the entire call throws. There is no cash-in-lieu assumption.
- Cash dividends require zero quantity; `price` is the gross cash distribution and
  `fee` reduces `dividendIncome`. Standalone fees require zero quantity and price;
  their `fee` contributes to `standaloneFees`. These cash events leave lots and
  capital gains unchanged. An explicit buy represents reinvestment. A `ratio` on
  any non-split transaction is rejected.

Quantities are BigInt-scaled at 10^8. Money starts as BigInt minor units; products
and allocated costs retain reduced BigInt fractions, including sub-minor amounts
and repeating per-unit costs. Sales and splits never round intermediate basis.
Splits change quantities and per-unit cost while preserving each lot's exact total
basis. Only final money values use half-even rounding, symmetrically for losses.
Sale gain and unrealised gain are rounded from their exact differences, so they
can differ from subtracting independently rounded output components.

Returned quantities are decimal strings without insignificant fractional zeroes;
money strings always have the supplied currency precision. `openLots` are in
acquisition order; `realisedGains` are in sale processing order. Final lot basis
values use whole minor-unit floors plus the aggregate rounding remainder on the
oldest open lot, so their sum equals the rounded total `costBasis`. This reporting
allocation never feeds calculations. `exactCostBasis` and `unitCost` retain the
unrounded reduced `{ numerator: bigint, denominator: bigint }` fractions in minor
units, with `unitCost` measured per whole share. BigInt fields need explicit
conversion if the caller serialises results to JSON.

`MAX_TRANSACTIONS` is 50,000; `MAX_SIGNIFICANT_DIGITS` is 30 per input amount or
ratio component (leading fractional zeroes excluded, trailing zeroes counted).
`MAX_QUANTITY_DECIMALS` is 8. Limits are exported and checked before the work they
bound: array length before traversal/allocation/sorting, derived decimal/ratio
string lengths before scanning/copying/BigInt conversion, and exponents before
scaling. Intermediate/aggregate results may exceed 30 digits; this is an input
limit, not an arithmetic truncation rule. FIFO advances an index through consumed
lots; average cost updates one pool. Splits traverse remaining lots.

Malformed inputs throw `HoldingsError` with a stable `code`, and messages contain
no input values:

| Code | Meaning |
| --- | --- |
| `OVERSOLD` | A sale exceeds quantity available at its processing position. |
| `CURRENCY_MISMATCH` | A transaction differs from the call's explicit currency. |
| `INVALID_AMOUNT` | Non-decimal, negative, non-string, overprecision or conflicting amount. |
| `INVALID_SPLIT` | Malformed/nonpositive ratio, conflicting split fields or inexact quantity. |
| `VALUE_TOO_LARGE` | Transaction, significant-digit, derived string-size or exponent bound exceeded. |
| `INVALID_INPUT` | Unsupported shape, missing field/precision, method, kind, date, ID or currency code. |

Records must be plain data (null-prototype records are accepted); arrays must be
dense plain arrays. Accessors, nonenumerable data, unknown fields, symbols and
custom prototypes are rejected. The API accepts ordinary inert data, not hostile
JavaScript proxies. The entire history is validated before replay, so a malformed
later row can be reported before an earlier oversell. Multiple validation failures
do not have a promised precedence, except the transaction-count check comes first.

Conservative interpretations are recorded in root `QUESTIONS.md`. Synthetic unit
tests exercise every behavior and error code, all named limits at bound/bound+1,
and every file at 100% statements, branches, functions and lines.
