<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MON-L5 conservative interpretations

1. **Conversion rounding and rate direction** (12-pure-libraries-4, MON-L5 task;
   07-parity-backlog, Money/Multi-currency): round, infer inverse/cross rates, or reject?
   Chosen: reject fractional minor units; accept only supplied positive decimal direct rates
   (target major units per source major unit). No inverse, triangulation, fetching or default rate.
2. **Amount representation and currencies** (MON-L5 exact decimal arithmetic): arbitrary bigint
   outputs or existing budget-compatible safe integer minor units? Chosen: signed safe integers
   with bigint intermediates and typed overflow; decimal strings at boundaries. Support the
   numeric minor-unit entries in the pinned SIX List One; reject historical/unknown/N.A. codes.
3. **Report semantics** (07-parity-backlog, Money/Reports; MON-L5): infer kinds/signs/timezones
   or require them? Chosen: match the existing budget transaction shape (signed income, expense,
   transfer; explicit categoryId or null). Expense refunds reduce spending; income reversals
   reduce income; transfers are excluded. Require target currency and inclusive YYYY-MM-DD
   periods; group occupied months/categories only, without category-tree rollups or zero filling.
4. **Period change** (MON-L5 period-over-period change): infer a previous period and round
   percentages, or accept explicit periods and return exact ratios? Chosen: explicit previous
   and current nonoverlapping periods with previous before current; compare income, expense
   and net. Percentage = 100 × (current − previous) / abs(previous), reduced exact fraction
   with decimal integer strings. Zero previous total gives null (undefined percentage).
   Period lengths may differ; no automatic annualisation or time normalisation.

These choices do not block the pure library. They are documented for future UI callers.
