<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Version retention

`planRetention(versions, now, limits?)` returns `{ keep, delete, freedBytes,
overBudget }`. Inputs and output timestamps use integer epoch milliseconds;
`now` is injected. The function never mutates its inputs or performs I/O.

Import the function, `ManagedVersion`, `RetentionLimits`, `RetentionPlan`,
`RetentionError`, `RetentionErrorCode`, `MAX_INPUT_VERSIONS`,
`DEFAULT_MAX_VERSIONS` and `DEFAULT_MAX_BYTES` from `index.ts`.

- All labels and the newest version are protected. Timestamp ties use ascending
  lexicographic ID order (JavaScript string comparison, independent of locale).
- Keep all versions younger than 24 hours; retain the newest per UTC clock hour
  from 24 hours to under 7 days, per UTC day from 7 through 30 days, and per
  Monday-start ISO week strictly after 30 days. Each age band has separate buckets.
  Labelled versions participate in choosing the newest bucket representative.
- After thinning, prune the oldest unlabelled candidates to meet `maxVersions`
  (default 100) and `maxBytes` (default 1 GiB). The newest remains protected even
  under a zero budget. Labels do not consume this pruning allowance.
- `overBudget` compares **all** retained versions, including labels, with both
  limits. It can remain true when the protected newest or labels exceed them.
- Both ID arrays are newest first with ascending IDs for ties. `freedBytes`
  includes age thinning and budget pruning. All sizes and limits are nonnegative
  safe integers; timestamps are signed safe integers, including pre-epoch dates.

Malformed lists, records, numeric fields, times or limits throw
`RetentionError('INVALID_VERSION')`. A future timestamp is invalid. Exact byte
totals use integer arithmetic; an unrepresentable numeric `freedBytes` is rejected
with the same code. Duplicate IDs throw `DUPLICATE_VERSION`. More than 100,000
versions throws `TOO_MANY_VERSIONS` before inspecting or copying any records.
Errors never echo caller-provided IDs. Records must be plain data objects, with
only the documented keys and no accessors. IDs are opaque strings.

The budget accounting and age-boundary readings are recorded in the repository's
`QUESTIONS.md` for the DRV-L6 brief.
