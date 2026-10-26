<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-cye3 questions and conservative readings

1. **Smart-list boundaries** (06-tasks §2.1, §2.3–2.4; TSK-L2): should Today
   mean today alone or today plus overdue? Follow the explicit Today screen: include
   overdue and today's open tasks. Upcoming is the seven local calendar dates
   starting today, without the separate overdue group; compose that group using Overdue.
   A timed task becomes overdue before the injected instant; an all-day task becomes
   overdue on the next local date.
2. **Repeat arithmetic** (06-tasks §5.4–5.5; TSK-L2): clamp, skip or reject
   nonexistent month dates? Skip invalid calendar dates (31st, leap day), preserving
   interval alignment; never clamp. Weekly intervals use Monday-based weeks. Due-based
   completion advances one occurrence even when still overdue, as §5.5 prescribes.
   Completion-based repetition anchors the interval at the completion's local date/time.
3. **DST and unsupported rules** (06-tasks §4.7, §5.4; 10-pure-libraries-2):
   choose an offset or reject ambiguous/nonexistent local times? Reject with a typed
   error. Support the requested daily/weekly/monthly/yearly subset, positive monthly
   byMonthDay, interval, count and inclusive until; reject additional rule fields,
   ordinal weekdays and negative month days. A count requires the caller's closed-copy
   count. Time-zone conversion is limited to 1970–9999 (historical offset transitions
   outside this supported range are rejected).
4. **Roll-up** (06-tasks §4.3, §4.6, §9.6): auto-complete parents or report
   progress? Report progress only; neither parent nor child completion propagates.
   Roll-up accepts a complete one-level snapshot and rejects duplicate IDs, missing
   parents, cycles and deeper nesting. Filtered views must roll up before filtering.
5. **Manual order** (06-tasks §4.4; TSK-L2): numeric schema:position or SH-L1
   order keys? The lane explicitly requests manual order keys: compare the existing
   SH-L1 base-62 key format lexically. Numeric RDF positions require an adapter and
   are rejected here. Equal sort values retain caller order; absent values sort last.
