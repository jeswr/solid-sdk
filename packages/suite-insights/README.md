<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/suite-insights

Pure TypeScript exploratory analysis of personal time series. No RDF, React, network,
storage or third-party runtime dependencies. Its shared coefficient helper comes from
`@jeswr/suite-charts/scale`, which has no React imports. The suite root supplies build/test tools.

`Series` declares `id`, `label`, `unit`, daily `aggregation` (`sum`, `mean`, `last`), and
`points: { at: Date | epochMilliseconds | ISOString, value: number }[]`.

- `calendarDay`, `shiftDay`, `dailySeries`, `alignDaily`, `alignDailyPoints`: explicit IANA time zone,
  chronological last-value selection, calendar-day joins and signed day lags. Civil
  dates retain their day in every zone. Offset-free date-times and invalid dates fail.
  Non-finite measurements are missing. Default joins omit unpaired days; explicit
  `missing: "null" | "zero"` fills the union's complete calendar span. Zero-filling is
  opt-in and is never used for findings. Joins/windows refuse spans over 10,000 days.
- `pearson`, `spearman`: pairwise finite observations, coefficient (null for fewer
  than two pairs or relatively near-constant values), sample size and strength: negligible < .1,
  weak < .3, moderate < .7, strong otherwise. Spearman uses average tied ranks.
- `laggedCorrelation`: positive lag means X on day D and Y on D + lag, including DST.
- `weekdayAggregation`: Monday-first mean of observed daily values and observed-day n.
  `hourlyAggregation`: local wall-clock hour buckets; civil dates are excluded.
- `rollingAverage`: trailing calendar windows, emitting gaps; minimum observed days
  defaults to the full window. `robustSummary`: median, interpolated quartiles, IQR,
  and Tukey 1.5-IQR outliers, without deleting observations. `mean` excludes non-finite
  measurements.
- `insights`: rank pairs by absolute Pearson r times sqrt(n), deterministic ID tie-break,
  default lags [-1, 0, 1], default limit 6. Emit only n >= 14, |r| and |rho| >= .3 with
  matching signs and at least seven observations in each median-split group.
  Findings describe the difference in Y between X-above-median and other observed
  days, in the source's declared units. Confidence is **data volume only**: low for
  14–29 paired days, moderate for 30–59, high for 60+. It is not a p-value or proof.
  `correlationVerdict` supplies cautious copy for Explore, including low-sample cases.

These are exploratory associations. Many comparisons, serial dependence, confounding,
missingness, units and measurement quality matter. There is no causal inference,
multiple-testing correction or clinical/financial recommendation. Inputs must describe
compatible measurements with a consistent aggregation and unit. Aggregation never
infers that an unobserved day means no activity. Input arrays are not mutated.

Run `pnpm exec turbo run lint build typecheck test --filter=@jeswr/suite-insights`.
