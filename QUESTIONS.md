<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# HLT-L3 questions and conservative interpretations

1. What input aggregation is intended? (11-pure-libraries-3, HLT-L3 task; 07 Health trends.)
   Options: sum incremental readings, take cumulative snapshots, or accept normalized daily totals.
   This lane accepts one explicitly normalized total per metric/local day and rejects duplicate
   days. Callers resolve source overlap and interval attribution before calling this pure library.
2. How should gaps and incomplete periods behave? (11, HLT-L3 rolling averages/streaks.)
   Options: impute zero, average observed days, or require complete windows. This lane requires
   all 7/30 calendar days; missing values produce null. Current streak ends today when achieved,
   otherwise yesterday (today is still in progress); missing/failed completed days break streaks.
   Longest streak is limited to supplied history. Future observations are rejected for goal progress.
3. What constitutes a trend or personal best? (11, HLT-L3; 07 Health trends.)
   Options: sample-index vs calendar-day regression, relative vs absolute thresholds, ties as records.
   This lane uses actual calendar-day offsets, an explicit nonnegative absolute threshold in metric
   units/day (equality is flat), and strictly higher daily totals. Fewer than two days yields null
   classification/slope; the first observed day establishes the initial personal best. Higher is a
   numeric record only, with no medical interpretation. Missing days are never treated as zero.
