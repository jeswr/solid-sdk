<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-oi07 specification questions

1. **Parser surface** (06-tasks §4.1 versus 09-pure-libraries / TSK-L1): should L1 also resolve
   projects/labels and parse reminders, or only return the fields named by its brief? Conservative
   choice: return unresolved project/label names; preserve reminder phrases in the title. Resolution,
   reminder output, multiline task trees and UI belong to the later composer task. Use the brief's
   `lib/quickadd/index.ts` location rather than the older `lib/quick-add.ts` location.
2. **DST and conflicting tokens** (06-tasks §4.1, §4.7): options include rejecting ambiguous times,
   shifting gaps, or selecting an offset; repeated project/priority tokens could use first or last.
   Conservative choice: leave nonexistent wall-time phrases in the title with no due/highlight;
   choose the earlier instant in a fold; first project/priority/recurrence wins and conflicting text
   stays in the title. An explicit date overrides the recurrence's initial due; otherwise start on
   the next matching date on or after local today, including today.
3. **Plain object encoding** (06-tasks §5.4 / VOC-01): no TypeScript object interface is specified.
   Choice: uppercase `freq`, positive `interval`, optional `byDay` array of English schema weekday
   names and `byMonthDay` array of integers. No RDF or RRULE string is emitted; the data layer maps
   weekday names to the mandated schema IRIs. Bare month words and date ranges remain title text.
