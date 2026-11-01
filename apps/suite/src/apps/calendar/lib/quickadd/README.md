<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Calendar quick add

`parseEventQuickAdd(text, { now: Date, tz: "Europe/London" })` is synchronous, pure
TypeScript. It uses the existing calendar zone helpers and runtime Intl data. It
does not read the system clock, use the host zone, perform I/O, or depend on React.

```ts
parseEventQuickAdd(
  "Lunch with Sam tomorrow 1pm at Cafe Rio for 90 minutes",
  { now: new Date("2026-10-23T11:00:00Z"), tz: "Europe/London" },
);
// { title: "Lunch with Sam", start: "2026-10-24T12:00:00.000Z",
//   end: "2026-10-24T13:30:00.000Z", durationMinutes: 90,
//   allDay: false, timeZone: "Europe/London", location: "Cafe Rio" }
```

The supported English grammar is intentionally bounded and case-insensitive:

- Put the title before the scheduling clauses. Whitespace is normalised; Unicode,
  email addresses and URLs are literal title text. Double-quoted text is literal.
- Dates: `today`, `tomorrow`, `YYYY-MM-DD`, optionally preceded by `on`.
- Clocks: `1pm`, `1:30pm`, `09:30`, `noon`, `midnight`, optionally preceded by `at`
  or `from`. Colon clocks without am/pm use 24-hour time. Bare `9` is rejected.
- End: `to 2pm` or `until 14:00`, on the same supplied date, strictly after start.
  Each endpoint must be unambiguous: `1pm to 2` is rejected. Overnight events
  require an elapsed duration; the parser never assumes a next-day end.
- Duration: `for N minutes` or `for N hours` (singular forms also supported).
  Decimal values must produce positive whole minutes. Timed durations are elapsed
  minutes, including across DST. All-day durations use positive whole `N days`.
- A date without a clock is all-day. Optional `all-day` or `all day` makes that
  explicit. `start` and exclusive `end` are ISO dates for all-day drafts; timed
  drafts use UTC ISO instants and retain the supplied `timeZone`.
- Location: `at Cafe Rio`; ends at the next scheduling cue. Quote names containing
  scheduling words or numbers: `at "Every Day Cafe"`, `at "Studio 42"`.
- Recurrence: `daily` / `every day`, `weekly` / `every week`, `every weekday`, or
  `every Monday` … `every Sunday`. The returned `rrule` is an RFC 5545 value, e.g.
  `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`. Weekdays use Monday–Friday, without holidays.

`Standup every weekday 9:30` starts at the next matching local day/time on or after
`now`. Bare weekly recurrence uses today's local weekday. All-day recurrence may
start today. Explicit dates anchor recurrence and must match its weekday selectors;
they can intentionally be in the past. A standalone clock requires a date.

No default end/duration is inferred. Duplicate fields, mixed end and duration,
all-day with a clock, unknown suffix text, numeric locale dates, named months,
relative offsets, approximate times, explicit zone overrides, recurrence intervals
and termination clauses are rejected. Dates and instants are bounded to 2000–2099,
matching the existing zone library; text is bounded to 4,096 UTF-16 code units.
Nonexistent and repeated DST wall times are rejected, including explicit endpoints
and the first recurrence occurrence. Later recurrence expansion belongs to the
calendar recurrence library, not this parser.

All failures throw `EventQuickAddError` with a stable `code`, the **entire original
phrase** in whitespace-normalised `title`, and `issues` containing codes and original
UTF-16 `start`/`end`/`text` spans. No partial draft is returned. The error message
does not include caller text. A consumer can keep `error.title` in the composer and
highlight `error.issues`, then request a corrected input. Missing dates/titles and
invalid injected clocks/zones are typed failures too. See root `QUESTIONS.md` for
the conservative choices where the brief leaves defaults unspecified.
