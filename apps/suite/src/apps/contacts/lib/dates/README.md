<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Contact dates

Pure TypeScript: no React, hooks, RDF, fetch, storage, timezone or implicit clock.
Import from `./index`:

```ts
const contacts = [{
  id: "https://example.org/contacts/mira#this",
  name: "Mira Quill",
  birthday: "2000-02-29",
  anniversary: "--12-31",
}];
extractContactDates(contacts); // birthday, then anniversary, with parsed source dates
planContactEvents(contacts, { startYear: 2025, leapDay: "feb28" });
upcomingContactDates(contacts, {
  start: "2025-01-01", end: "2025-12-31",
}, { leapDay: "mar1" }); // birthday March 1, age 25; anniversary December 31, no age
```

`DatesContact` is an explicit projection: adapters supply `{ id, name, birthday?, anniversary? }`
from the typed contact layer (`vcard:bday` / anniversary values). The current shared
`ContactData` does not expose these dates, so this lane does not extend or parse RDF.
Unknown top-level fields, accessors, non-enumerable/symbol properties, class instances,
missing/blank identity or name, and duplicate IDs are rejected. Null-prototype data records
are accepted. IDs compare exactly as opaque strings; this library does not dereference them.
Dates are optional only by omission: explicit null, undefined and blank dates are invalid.

Only exact `YYYY-MM-DD` and year-less `--MM-DD` Gregorian dates are supported. Years are
0001–9999. February 29 is valid without a year; with a year it must be a leap year, using
the Gregorian century/400-year rule. Partial years/months, date-times, offsets, alternate
calendars, locale-specific dates and invalid days fail closed, without trimming, guessing
or rolling over. The caller chooses dates in its own timezone before calling the library.

`planContactEvents` returns one one-day all-day plan per occasion, in input order (birthday
before anniversary). The first occurrence is in `max(startYear, sourceYear)` for known
dates, or `startYear` otherwise. `startYear` is required, including for empty input.
Titles contain the supplied contact name and occasion kind. Plans retain provenance through
`contactId`, `contactName`, `kind` and `sourceDate`; they perform no writes or deduplication.

The required `leapDay` policy is `feb28` or `mar1`; both retain February 29 in leap years.
The yearly recurrence descriptor preserves the **original** month/day and explicit policy,
even when the first occurrence is substituted. It is a semantic plan for the Calendar adapter,
not a directly serializable RRULE: `FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29` alone would skip
non-leap years. Consumers must apply the substitution policy when expanding/persisting the
plan rather than replacing its recurrence anchor with the first substituted date.

`upcomingContactDates` uses inclusive full-date bounds and emits every annual occurrence
in the window, including multiple years. Dates before the original known year are omitted;
the original occurrence has age zero. `age` is completed years at the emitted occurrence
(anniversary years for anniversaries), and is absent for year-less dates. Results sort by
date, then contact ID, then kind, using locale-independent UTF-16 order. Same-day occasions
are separate entries. Date windows can span the entire supported range; work is proportional
to the number of occasions multiplied by years in the window (at most 9999 per occasion).

Options/window records reject unknown fields. Malformed inputs throw `ContactDatesError`
with typed `code`: `invalid-contact`, `duplicate-contact`, `invalid-date`, `invalid-options`
or `invalid-window` (reversed bounds/unsupported window shape). Missing or unsupported date
bounds use `invalid-date`. Errors never echo personal data. All inputs are validated even
for an empty result; no partial list is returned after an error. Inputs are never mutated
and returned records/arrays are fresh, including source dates for each occurrence.

Root `QUESTIONS.md` records the conservative interpretations for CON-L4. Tests use synthetic
people and `example.org`; Vitest enforces 100% statements, branches, functions and lines
for this directory, including the public barrel.
