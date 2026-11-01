<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Quick add

`parseQuickAdd(text, { now: Date, tz: "Europe/London", locale: "en-GB" })` is a pure English
parser. The clock and IANA zone are required; `locale` defaults to `en-GB` (`en-US` also supported).
Invalid clocks/zones throw `RangeError`. It returns `title`, optional `due` and `recurrence`,
`priority` (default 4), optional unresolved `project`, `labels` and highlighting `spans`.

All-day due values are `{ kind: "date", date: "2026-10-26" }`; timed values are
`{ kind: "dateTime", dateTime: "2026-10-26T17:00:00.000Z", timeZone: "Europe/London" }`.
Spans contain `kind`, `start`, `end` and original `text`; offsets are half-open UTF-16 indices.
`keepDateText: true` retains the recognised due phrase in the title without losing its span.

Recurrence is recognised before dates: daily/every day, every weekday, weekly/every week,
every mon…sunday, every N days/weeks/months/years, monthly/every month, yearly/every year,
and every 1st…31st (monthly day). Rules use uppercase `freq`, `interval`, optional `byDay`
(schema weekday names) and optional `byMonthDay` integer arrays, per VOC-01. The initial due is
on or after local today; explicit dates override it. Bare interval rules start today. Missing
monthly dates are skipped rather than clamped. A lone time qualifies the initial recurrence day.
Future occurrence expansion and nth-weekday rules are outside this library.

Tokens are whitespace-delimited `#project`, `@label` and case-insensitive `p1`…`p4`. Names use
Unicode letters/numbers, underscores and hyphens. First project, priority, recurrence and date
win; conflicting tokens remain title text. Labels deduplicate case-insensitively (first spelling),
with a span for each token. Unknown project names are returned for the caller to resolve/create.
URLs, emails, reminder tokens, bare month words and date ranges remain title text. Reminders,
resource matching, multiline hierarchy and chips belong to the consuming composer (TSK-05).

Calendar dates use the injected zone, never the machine zone. Nonexistent DST wall times remain
in the title with no due/span; repeated times choose the earlier instant. An explicit numeric or
named timezone recognised by chrono overrides the injected zone for that phrase's instant.

`this week <weekday>` resolves a single named weekday within the injected calendar's
Sunday-based week, including dates earlier than today; an optional time and explicit zone
are supported. Unqualified `this week`, `this month` and `this year` still use their period
boundaries. Unsupported merged week qualifiers (such as multiple weekdays or a relative
weekday modifier) throw `RangeError` rather than silently dropping the qualifier.

Anchored offsets (`2 hours before 5pm`, `2 days after Monday`, `5pm +2 hours`) remain literal.
When an unmasked offset has an anchor, the parser leaves all deadline text in that input unparsed
and does not parse recurrence or infer a due date; metadata tokens still parse.
This avoids resolving the offset against now or consuming only part of its anchor. Elapsed
phrases such as `in 1h30m` and `two hours ago` still resolve against the injected instant.
Time-first reminders include calendar qualifiers explicitly connected by `on` (`!9am on Monday`);
a separate following deadline (`tomorrow 5pm`) remains eligible for due parsing. If a connected
qualifier is unrecognised, its remaining text stays literal without a partial deadline.
