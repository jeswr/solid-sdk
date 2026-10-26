<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MUS-L6 conservative interpretations

1. **Limit scope** (MUS-L6 description; 14-pure-libraries-6): apply 64 MiB and
   1,000,000 listens to each source separately, or to the combined import? Apply
   both to the combined import, counting raw rows before validation/deduplication.
   Strings are measured as UTF-8 bytes; preflight counting precedes materialization.
2. **CSV schema** (MUS-L6 description): require only artist/track/timestamp headers,
   or all four named columns? Require exact, unique artist/album/track/timestamp
   headers; album values may be empty. Extra uniquely named columns are allowed.
   Wrong-width records receive INVALID_LISTEN and are skipped.
3. **Duplicate windows and completeness** (MUS-L6 description): the 30-second
   relation is not transitive, and field counting is unspecified. Count album,
   duration, recording MBID, release MBID, and a nonempty artist-MBID list as one
   field each. Prefer completeness, then ListenBrainz, then earliest timestamp,
   then input order. Keep a candidate only if it is more than 30 seconds from
   every retained matching artist/track. Apply this same rule within a source.
   Whitespace-insensitive comparison removes all whitespace, without rewriting
   the displayed artist/track. Do not merge fields from discarded records.
4. **Timestamp and warning details** (MUS-L6 description): accept integer epoch
   seconds and the exact English UTC CSV date format, rejecting date rollover.
   Invalid optional album/duration/metadata shapes skip the row with INVALID_LISTEN;
   invalid MBIDs alone are dropped with INVALID_MBID. Warning lines are one-based
   physical record-start lines, including multiline JSON arrays and quoted CSV.

These choices do not block implementation; they need no new dependencies or UI.
