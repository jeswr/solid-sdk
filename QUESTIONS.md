<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-L4 interpretation questions

1. **Contact boundary** (07-parity-backlog, Contacts / Existing data layer and Data mapping;
   12-pure-libraries-4, CON-L4): neither current `ContactData` nor the app's dedupe projection
   exposes birthdays/anniversaries. Options: extend the RDF model, or accept an explicit plain
   projection. Conservative choice: `{ id, name, birthday?, anniversary? }`, with date strings
   supplied by a future typed adapter; no RDF model changes in this pure-library lane.
2. **Window and age** (12-pure-libraries-4, CON-L4): endpoints and anniversary age are unspecified.
   Options: inclusive or exclusive end, birthday-only age or elapsed years for both kinds.
   Conservative choice: inclusive Gregorian date-only endpoints, elapsed years at each occurrence
   for either kind, omitted for year-less sources; never emit occurrences before the source date.
3. **Recurrence plans** (12-pure-libraries-4, CON-L4; 07-parity-backlog, Calendar / Recurrence):
   the plan API and default leap policy are unspecified. Options: silently pick a reference year
   and leap policy, or require both. Conservative choice: require `startYear` for plans and
   `leapDay: "feb28" | "mar1"` for both planning and upcoming lists. Plans preserve the original
   month/day and policy in an explicit yearly recurrence descriptor; a plain February 29 RRULE
   would skip non-leap years and is not an equivalent serialization. All-day duration is one day.
