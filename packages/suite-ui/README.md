<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-ui

Normative tokens from `01-design-system` §2.1–2.7 and Amendment 2026-10-25. Import `styles/tokens.css`,
`styles/theme.css` (Tailwind v4), and `styles/density.css`. Set `.dark` for dark
mode and `data-density="comfortable|compact"` for density. Coarse pointers force
comfortable rows and 44px controls. Reduced motion zeros motion durations.

`tokens` exports the typed inventory, including both themes and compact values.
`fonts` exports `onest`, `sourceSerif`, and `sourceCode` for Next.js root layouts;
apply their `.variable` classes to `<html>` so the `:root` font aliases resolve.
The default entry has no Next.js runtime import.

The frozen `test/spec-tokens.json` is the spec transcription; the snapshot and CSS
parity test guard changes. Run `pnpm check:tokens` and `pnpm check:contrast` at the
workspace root. `--input` supplies form control boundaries with at least 3:1 contrast
against `--background` and `--surface` in both themes. `--border-strong` remains
the decorative border token. Warning text on `--warning` meets 4.5:1 in both themes.

Date/time inputs are exported from `@jeswr/suite-ui/date-time`; import
`@jeswr/suite-ui/styles/date-time.css` after the token, theme and density styles.
`DateTimeField`, `DatePickerPopover` and `RecurrenceEditor` are client components
with controlled `value`/`onChange`, visible labels and a required account `locale`.
All parsing is synchronous; these controls have empty, interpreted, validation and
disabled states, without artificial network-loading or storage-error states.
Fixtures live at `/dev/components/{date-time-field,date-picker-popover,recurrence-editor}`.

`DateTimeValue` is `{ kind: "date", date: "YYYY-MM-DD" }` for all-day values (V4),
or `{ kind: "dateTime", dateTime: "<ISO instant>" }`. Natural English phrases use
chrono-node, with day-first numeric dates for en-GB and month-first for en-US.
A complete single-date phrase is required; ranges and leftovers are rejected.
Pass `referenceDate` for a deterministic clock; otherwise it is frozen at mount.
Local wall-time editing follows the host timezone. The caller supplies the account
locale and handles account timezone conversion. Remount on account changes.
Invalid drafts are announced and never emitted. Empty input emits `null`.
`initialText` restores a draft; it is interpreted immediately and emitted on edits.

`RecurrenceEditor` requires a valid all-day `startDate` to seed weekday/month defaults.
It emits the Tasks domain object `{ freq, interval, byDay?, byMonthDay?, byMonth?,
bySetPos?, count?, until? }` or `null` for no recurrence. Weekdays are full English names,
with RDF adapters responsible for schema.org IRIs. `byMonthDay` and `byMonth` are
arrays, matching the existing Tasks quick-add type. `count` and `until` are exclusive;
`until` is an ISO date or UTC dateTime at whole-second precision. `bySetPos` is the
monthly ordinal (1–5 or -1): the persistence question is recorded in root QUESTIONS.md.
Dates absent from a month are skipped. These controls do not expand recurrences.

Pure `parseDateTime`, `toRRule`, `fromRRule`, types and validation are also exported
from `@jeswr/suite-ui/date-time/model`, usable in server/data code without React.
The RFC 5545 codec supports the editor's daily/weekly/monthly/yearly subset and
encodes monthly ordinal weekdays as `BYDAY=2TU` / `BYDAY=-1FR`. It rejects unsupported
parts instead of silently dropping them. `DTSTART` and timezone belong to the caller;
no RRULE string is persisted. Calendar uses the shadcn single-month anatomy over
[React DayPicker](https://ui.shadcn.com/docs/components/base/calendar); Popover uses Radix.
