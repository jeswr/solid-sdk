<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MON-L4 conservative readings

1. **Missing calendar dates** (07-parity-backlog, Money recurring/scheduled row;
   11-pure-libraries-3, MON-L4): options are skip, clamp, or reject the whole template.
   Use calendar matching: day 31 skips shorter months, February 29 skips non-leap
   years, and explicit `last` always means the month's actual last day. Never move
   an occurrence to another date.
2. **Detection thresholds** (11-pure-libraries-3, MON-L4): options include date jitter,
   fuzzy payees, multiple inferred amount clusters, or exact matching. Require at
   least three observations, exact payee/account/currency/sign, an explicit absolute
   minor-unit tolerance across the group's entire amount span, and an uninterrupted
   supported calendar schedule. Return suggestions only, using the latest amount;
   do not automatically create templates. Multiple competing charges at one payee
   can therefore produce no suggestion. No fuzzy matching or weekend adjustment.
3. **Forecast boundary and bills** (same sections): options include inferring an
   opening date, reconciling posted transactions with templates, or explicit input.
   Opening balances mean immediately before the inclusive range start. Apply only
   in-range supplied one-off transactions plus templates; callers exclude already
   posted template occurrences to avoid double counting. Bills are negative template
   occurrences in that explicit range; income and zero amounts are excluded.
4. **Recurrence shape** (07-parity-backlog, Money says reuse sched:RecurrenceRule;
   MON-L4 requires plain TypeScript): use a small discriminated data union for the
   requested frequencies, with template start/end date bounds and monthly day/last.
   Yearly month/day and weekly phase come from startDate. RDF/RRULE translation is
   outside this pure library. Reject extra fields and unsupported frequencies.
