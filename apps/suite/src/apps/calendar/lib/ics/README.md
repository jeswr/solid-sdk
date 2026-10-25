<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Pure RFC 5545 VEVENT boundary: `importICal(text)` and `exportICal({ events, timezones? })`.
No dependencies, I/O, recurrence expansion, randomness, or host timezone conversion.

Events use `name`, ISO `start`/`end`, `location`, `description`, `recurrence`, and
`reminders`. Required `uid` and UTC `dtstamp` preserve identity and deterministic exports.
DATE is `YYYY-MM-DD`; DATE-TIME is `YYYY-MM-DDTHH:mm:ss` with optional `Z`.
TZID accompanies a wall-clock value (`tzid` for start, `endTzid` for end); each is independent.
DATE ends are exclusive; a missing end stays absent. Leap-second `:60` is retained.
Recurrence selectors use RFC weekday codes (`MO`, `-1FR`); `exceptDate` belongs to
`recurrence` when a rule exists, otherwise to the event. `rdate` and exceptions contain
`{ value, tzid? }` entries. Rules retain all RFC BY* selectors, COUNT/UNTIL, and WKST.
Reminders use `triggerOffset` (duration) or UTC `triggerTime`; DISPLAY, AUDIO and EMAIL,
RELATED, repeat/duration, text, recipients and URI attachments are supported.

Supplied VTIMEZONE definitions are retained as opaque components. Callers provide definitions
when required for export; this module does not generate a timezone database or evaluate DST.
Comparison of ends in different timezones is left to that engine.

Malformed supported fields throw `Error` prefixed `Invalid iCalendar:`. Unrelated components
and unknown properties are ignored. This is a documented subset: event DURATION,
RECURRENCE-ID overrides, RDATE PERIOD, binary alarm attachments, and extension RRULE parts
are rejected. Those features require an expanded model before import can preserve them.
It is not a lossless editor for arbitrary iCalendar properties or parameters.

Run directory coverage (100% statements, branches, functions and lines required):

```sh
pnpm --filter @jeswr/app-suite exec vitest run --coverage
```
