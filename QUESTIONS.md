<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-04 conservative readings

1. **Calendar class:** connectors DESIGN §2 D5 says `sched:Event`; vocab DECISIONS V10
   and the scheduling ontology define `sched:CalendarEvent`. Options: mint `sched:Event`,
   or use the defined class. This lane uses `sched:CalendarEvent` plus `schema:Event`,
   consistent with the existing CON-02 mapping. No new vocabulary is minted.
2. **Recurrence beyond VOC-01:** connectors DESIGN §2 D5 refers to the shape in vocab
   DECISIONS V5, which defines frequency, interval, count, until, weekdays, month days,
   months and exception dates. Options: invent extensions for ordinal weekdays, RDATE,
   EXRULE and other RFC 5545 parts, silently approximate them, or reject unsupported
   constructs without advancing the checkpoint. This lane takes the last option.
   EXDATE supports dates, UTC timestamps and local timestamps in the rule's own time zone;
   a different exception time zone is rejected. No raw RRULE string is stored.
