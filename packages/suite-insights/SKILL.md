---
name: suite-insights
description: Use when aligning personal time series by local day, computing exploratory correlations or lagged findings, or summarising weekday, hourly and rolling patterns without RDF or React.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Personal time-series analysis

`@jeswr/suite-insights` supplies pure calendar-aware analysis. Read [README.md](README.md)
for the public API and confidence/strength thresholds. It does no I/O, RDF or React work.
The coefficient calculation delegates to `@jeswr/suite-charts/scale`, a React-free entry;
this package owns finite-pair filtering, relative variance guards and interpretation.

## Public API

- `Series`, `Sample`, `DailyPoint`: measurements, explicit units and daily sum/mean/last policy.
- `calendarDay`, `shiftDay`, `dailySeries`: validate timestamps, project local days and aggregate.
- `alignDaily`, `alignDailyPoints`: align raw or prepared daily observations; opt-in null/zero gaps.
- `pearson`, `spearman`, `laggedCorrelation`, `correlationVerdict`: paired results and cautious copy.
- `mean`, `robustSummary`: finite-only mean, median, quartiles, IQR and Tukey outliers.
- `weekdayAggregation`, `hourlyAggregation`, `rollingAverage`: observed-time patterns.
- `insights`: rank candidate pairs and signed lags with descriptive confidence and paired days.

## Invariants

- Supply an explicit IANA time zone. Civil dates keep their day; date-times require an offset.
  Invalid timestamps/zones throw; callers ingesting untrusted points must drop and count them.
- Missing measurements never imply zero. Input arrays remain untouched. Chronological last
  values and calendar-day lags/windows retain their semantics across DST changes.
- Positive lag pairs X today with Y later. Discovery defaults to `[-1, 0, 1]` and aggregates
  each series once for reuse across pairs/lags. Calendar formatters are cached by time zone.
- Near-constant relative variance yields no coefficient. Scaling measurements into smaller
  units must not change the coefficient. Spearman uses average ranks for ties.
- A finding requires 14 paired days, consistent Pearson/Spearman signs and magnitudes of .3,
  and seven days in each median-split group. Confidence describes volume, never causation
  or statistical significance. Shared trends and repeated comparisons can create spurious patterns.
- Joins and rolling windows reject spans over 10,000 days; lags are integer days within ±365.

## Validation

Use Node 24 and run `pnpm exec turbo run lint build typecheck test --filter=@jeswr/suite-insights`.
Tests enforce full coverage, formatter reuse, bidirectional discovery and a 100,000-point budget.
