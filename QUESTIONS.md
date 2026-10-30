<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CAL-L7 conservative interpretations

1. CAL-L7 / specs/apps/13-pure-libraries-5.md and 07-parity-backlog.md Calendar do not
   specify defaults for omitted dates or durations. Options: infer today and a default
   length, or require a date and leave the end absent. Use the latter. Date-only input
   represents an all-day draft; an explicit all-day marker cannot accompany a clock time.
2. CAL-L7 asks both to preserve/report ambiguous text and to reject unsupported inputs.
   Options: return a partially scheduled draft, or throw a typed error retaining the
   original phrase as its title and reporting source spans. Use the latter so callers
   cannot accidentally save a partially interpreted schedule. Ordinary title text is
   accepted before the first scheduling clause; the scheduling suffix must parse fully.
3. The weekday example supplies no first date. Options: use local today regardless of
   the rule, or the next matching occurrence on/after supplied now. Use the latter;
   explicit dates must match the rule. Reject DST gaps and overlaps without choosing an
   instant. Support a documented bounded English grammar rather than general NLP.
