<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MON-L7 scope interpretations (sst-gu8i)

1. **Dividend and standalone fee semantics.** `tasks.json` MON-L7 and
   `14-pure-libraries-6.md` name these kinds without specifying basis adjustments.
   Options: infer reinvestment/return of capital, reject them, or treat them as cash
   events. Conservative choice: dividend `price` is the gross cash amount, `fee`
   reduces dividend income; a standalone fee uses `fee`. Both require zero quantity;
   standalone fees require zero price. Report them separately from capital gains,
   without changing lots. Reinvestment requires an explicit buy transaction.
2. **Split representation and precision.** MON-L7 says ratio `n:m` but omits its
   field and treatment of quantities needing more than eight decimals. Options:
   overload quantity, add a split-only `ratio`, round quantities, or reject inexact
   quantities. Choice: a required `ratio` on splits, positive integer components;
   quantity/price/fee must be zero. Reject unrepresentable post-split quantities
   with `INVALID_SPLIT`; do not invent cash-in-lieu or discard fractional shares.
3. **Exact basis versus reported minor units.** MON-L7 requires final-only half-even
   rounding and assigns remainder minor units to the oldest lot. Options: round
   basis during processing or preserve rational minor units. Choice: BigInt-scaled
   quantities and reduced BigInt fractions for all intermediate costs. Final open
   lot basis values are floored, with the difference from the half-even rounded
   total assigned to the oldest open lot. Exact basis and per-unit cost fractions
   are also returned; reported rounding never feeds subsequent sales or splits.
4. **Unspecified API/validation shapes.** MON-L7 does not define dates, empty-input
   currency, or average-cost lot identity. Choice: strict Gregorian `YYYY-MM-DD`
   (as in neighbouring Money libraries), unique nonempty opaque IDs, explicit
   currency/current price/method/table options, FIFO lots or one average-cost pool
   identified by its oldest still-pooled acquisition. Canonical nonnegative decimal
   strings only; positive trade quantities. Supplied currency exponents are integers
   from zero through the exported 30-digit value bound. Reject unsupported shapes,
   missing currency precision, unknown kinds/options and conflicting fields with
   typed errors. No currency inference or FX conversion.
