// AUTHORED-BY Codex GPT-6.1-Sol
import { en } from "chrono-node";
import { durationPattern, elapsedInstant } from "./elapsed";
import { parseRecurrence, recurrencePattern, recurrenceStart } from "./recurrence";
import { localCalendar, toInstant } from "./time";
import type { Due, QuickAddContext, QuickAddResult, QuickAddSpan, RecurrenceRule } from "./types";

const reminderTime =
  "(?:\\d{1,2}(?::\\d{2}(?::\\d{2})?)?\\s*[ap]m|\\d{1,2}:\\d{2}(?::\\d{2})?|noon|midnight|now)\\b";
const reminderPrefix = new RegExp(
  `^(?:(?:(?:in|within|for)\\s*)?${durationPattern}(?:\\s+(?:before|ago|later|from now))?(?:\\s+(?:at\\s+)?${reminderTime})?|(?:at\\s+)?${reminderTime})`,
  "i",
);

/** Pure English quick-add parser. See README.md for conflict and DST policies. */
export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAddResult {
  if (!Number.isFinite(ctx.now.getTime())) throw new RangeError("Invalid quick-add clock");
  const today = localCalendar(ctx.now, ctx.tz);
  const parser = ctx.locale === "en-US" ? en.casual : en.GB;
  const spans: QuickAddSpan[] = [];
  let working = text;
  const mask = (start: number, length: number) => {
    working = working.slice(0, start) + "\u0000".repeat(length) + working.slice(start + length);
  };
  const addSpan = (kind: QuickAddSpan["kind"], start: number, length: number) => {
    spans.push({ kind, start, end: start + length, text: text.slice(start, start + length) });
  };
  const result: QuickAddResult = { title: "", priority: 4, labels: [], spans };
  // Mask all token candidates, including conflicts, before natural-language date parsing.
  for (const match of text.matchAll(
    /(?<!\S)([#@])([\p{L}\p{N}_][\p{L}\p{N}_-]*)(?=$|[\s,.;!?])/gu,
  )) {
    const name = String(match[2]);
    mask(match.index, match[0].length);
    if (match[1] === "#") {
      if (result.project !== undefined) continue;
      result.project = name;
      addSpan("project", match.index, match[0].length);
    } else {
      if (!result.labels.some((label) => label.toLowerCase() === name.toLowerCase()))
        result.labels.push(name);
      addSpan("label", match.index, match[0].length);
    }
  }
  let hasPriority = false;
  for (const match of working.matchAll(/(?<!\S)p([1-4])(?=$|[\s,.;!?])/giu)) {
    mask(match.index, match[0].length);
    if (hasPriority) continue;
    hasPriority = true;
    result.priority = Number(match[1]) as QuickAddResult["priority"];
    addSpan("priority", match.index, match[0].length);
  }
  // The L1 output excludes reminders and resource resolution. Preserve these in the title.
  for (const match of working.matchAll(/\S*[@#]\S*|https?:\/\/\S+/giu)) {
    mask(match.index, match[0].length);
  }
  for (const marker of working.matchAll(/!\s*/g)) {
    const remaining = working.slice(marker.index + marker[0].length);
    // Bound time-first reminders before chrono can merge them with the following deadline.
    // Calendar-first reminders can include their own date and time as one complete phrase.
    const reminder =
      reminderPrefix.exec(remaining)?.[0] ??
      parser
        .parse(remaining, { instant: today, timezone: 0 }, { forwardDate: true })
        .find((candidate) => candidate.index === 0)?.text;
    if (reminder) {
      let length = reminder.length;
      const suffix = remaining.slice(length);
      const connector = /^\s+on\s+/i.exec(suffix);
      if (connector) {
        // Parse one calendar qualifier without merging an adjacent, separate deadline.
        const calendarParser = parser.clone();
        calendarParser.refiners = [];
        const qualifier = calendarParser
          .parse(suffix.slice(connector[0].length), { instant: today, timezone: 0 })
          .find((candidate) => candidate.index === 0);
        // Unknown connected qualifiers stay literal, including their remaining text.
        length += qualifier ? connector[0].length + qualifier.text.length : suffix.length;
      }
      mask(marker.index, marker[0].length + length);
    }
  }
  // Chrono merges anchored offsets into relative results, discarding their anchor.
  // Until exact anchor resolution is supported, preserve all deadline text in that input.
  const parsed = parser.parse(working, { instant: today, timezone: 0 }, { forwardDate: true });
  const signedAnchor = new RegExp(`^.+\\s[+-]\\s*${durationPattern}`, "i");
  const unresolvedAnchor =
    new RegExp(`${durationPattern}\\s*(?:before|after|since|from(?!\\s+now\\b))\\b`, "i").test(
      working,
    ) ||
    parsed.some(
      (candidate) =>
        signedAnchor.test(candidate.text) ||
        (/^[+-]/.test(candidate.text) &&
          parser
            .parse(working.slice(0, candidate.index), { instant: today, timezone: 0 })
            .some((anchor) =>
              /^\s*$/.test(working.slice(anchor.index + anchor.text.length, candidate.index)),
            )),
    );
  let recurrence: RecurrenceRule | undefined;
  for (const match of unresolvedAnchor ? [] : working.matchAll(recurrencePattern)) {
    mask(match.index, match[0].length);
    if (recurrence) continue;
    const rule = parseRecurrence(match[0]);
    if (!rule) continue;
    recurrence = rule;
    addSpan("recurrence", match.index, match[0].length);
  }
  if (recurrence) result.recurrence = recurrence;
  // A UTC surrogate supplies the injected zone's wall clock to chrono, independent of host TZ.
  const matches = (
    unresolvedAnchor
      ? []
      : parser.parse(working, { instant: today, timezone: 0 }, { forwardDate: true })
  ).flatMap((candidate) => {
    const tags = candidate.start.tags();
    const elapsed = tags.has("result/relativeDateAndTime") || tags.has("casualReference/now");
    if (elapsed || !candidate.start.isCertain("timezoneOffset")) return [candidate];
    // Infer explicit-zone dates against the real clock in that zone.
    return parser
      .parse(
        candidate.text,
        {
          instant: ctx.now,
          timezone: Number(candidate.start.get("timezoneOffset")),
        },
        { forwardDate: true },
      )
      .map((resolved) => ({ ...resolved, index: candidate.index + resolved.index }));
  });
  const match = matches.find(
    (candidate) =>
      !candidate.end &&
      !(
        candidate.start.tags().has("parser/ENMonthNameParser") && !candidate.start.isCertain("day")
      ),
  );
  let due: Due | undefined;
  if (match) {
    const start = match.start;
    const tags = start.tags();
    if (tags.has("result/relativeDateAndTime") || tags.has("casualReference/now")) {
      due = {
        kind: "dateTime",
        dateTime: elapsedInstant(match.text, ctx.now).toISOString(),
        timeZone: ctx.tz,
      };
    } else {
      const calendar = new Date(
        Date.UTC(
          Number(start.get("year")),
          Number(start.get("month")) - 1,
          Number(start.get("day")),
        ),
      );
      // Chrono's "this period" parser reads host-local fields from the surrogate.
      // Resolve period boundaries directly from the injected calendar instead.
      const periodMatch = /^this\s+(week|month|year)s?\b/i.exec(match.text);
      const period = periodMatch?.[1]?.toLowerCase();
      if (periodMatch) {
        const reference = start.isCertain("timezoneOffset")
          ? new Date(ctx.now.getTime() + Number(start.get("timezoneOffset")) * 60_000)
          : today;
        calendar.setTime(reference.getTime());
        if (period === "week") {
          calendar.setUTCDate(calendar.getUTCDate() - calendar.getUTCDay());
          // Chrono can also discard weekday metadata when merging "this week Saturday".
          // Reparse the complete suffix before applying a weekday to the injected boundary.
          // Normalize Chrono's supported date/time punctuation before checking consumption.
          const suffix = match.text
            .slice(periodMatch[0].length)
            .trim()
            .replace(/^[,.:∙-]\s*/, "")
            .replace(/^at\s+/i, "");
          if (suffix) {
            const [qualifier, ...others] = parser.parse(suffix, { instant: today, timezone: 0 });
            if (
              !qualifier ||
              others.length > 0 ||
              qualifier.index !== 0 ||
              qualifier.text !== suffix ||
              qualifier.end ||
              (["day", "month", "year"] as const).some((part) => qualifier.start.isCertain(part))
            ) {
              throw new RangeError("Unsupported quick-add period qualifier");
            }
            const weekday = qualifier.start.get("weekday");
            if (weekday !== null) {
              if (/\b(?:this|next|last|past|weekday|weekend)\b/i.test(suffix)) {
                throw new RangeError("Unsupported quick-add period weekday qualifier");
              }
              calendar.setUTCDate(calendar.getUTCDate() + weekday);
            }
          }
        } else calendar.setUTCDate(1);
        if (period === "year") calendar.setUTCMonth(0);
      }
      // A lone time qualifies the recurrence's initial day, rather than changing its weekday.
      if (
        recurrence &&
        !period &&
        start.isCertain("hour") &&
        !(["day", "weekday", "month", "year"] as const).some((part) => start.isCertain(part))
      ) {
        calendar.setTime(recurrenceStart(recurrence, today).getTime());
      }
      if (start.isCertain("hour")) {
        calendar.setUTCHours(
          Number(start.get("hour")),
          Number(start.get("minute")),
          Number(start.get("second")),
          0,
        );
        const offset = start.isCertain("timezoneOffset") ? start.get("timezoneOffset") : null;
        const instant =
          offset === null
            ? toInstant(calendar, ctx.tz)
            : new Date(calendar.getTime() - offset * 60_000);
        if (instant) due = { kind: "dateTime", dateTime: instant.toISOString(), timeZone: ctx.tz };
      } else {
        due = { kind: "date", date: calendar.toISOString().slice(0, 10) };
      }
    }
    if (due) addSpan("due", match.index, match.text.length);
  } else if (recurrence && !unresolvedAnchor) {
    due = { kind: "date", date: recurrenceStart(recurrence, today).toISOString().slice(0, 10) };
  }
  if (due) result.due = due;
  spans.sort((a, b) => a.start - b.start);
  let cursor = 0;
  const title: string[] = [];
  for (const span of spans) {
    if (span.kind === "due" && ctx.keepDateText) continue;
    title.push(text.slice(cursor, span.start));
    cursor = span.end;
  }
  title.push(text.slice(cursor));
  result.title = title.join(" ").trim().replace(/\s+/g, " ");
  return result;
}
