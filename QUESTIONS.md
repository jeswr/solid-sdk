<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-gv51 — HLT-L1 interpretation questions

1. **Calendar conventions** (09-pure-libraries; HLT-L1 in apps/tasks.json): the spec
   requests timezone-aware day/week/month buckets but gives no week-start or output
   convention. Options are locale-dependent weeks or fixed ISO Monday weeks. This lane
   uses Monday weeks and Gregorian local-date labels for bucket starts, with an explicit
   caller-supplied timezone. Labels are calendar dates, not UTC midnight instants.
2. **Gaps and moving averages** (same sections): options include elapsed-time gaps or
   missing calendar buckets, and sample-based or time-based moving averages. This lane
   detects missing calendar buckets in an explicit inclusive local-date range, including
   leading/trailing gaps. Moving averages use trailing fixed-size sample windows, returning
   null until the window is full or whenever it contains a null. Callers can insert null
   for detected gaps; there is no interpolation, zero-fill, or medical interpretation.
3. **Numeric/ordering conventions** (same sections; 07-parity-backlog, Health trends):
   options include mixed-unit aggregation or caller-normalised single-metric series.
   This lane requires one metric in one unit per series, exposes conversion separately,
   preserves precision without display rounding, and rejects non-finite numbers.
   `last` means latest timestamp, with the later input winning equal timestamps.
   Glucose uses the conventional approximate factor 18 mg/dL per mmol/L; the alternative
   is a molar-mass-based factor. Timestamps are integer Unix milliseconds to avoid
   ambiguous timezone-free date parsing.
