// AUTHORED-BY Codex GPT-6.1-Sol
import { en } from "chrono-node";
import { parseRecurrence, recurrencePattern, recurrenceStart } from "./recurrence";
import { localCalendar, toInstant } from "./time";
import type { Due, QuickAddContext, QuickAddResult, QuickAddSpan, RecurrenceRule } from "./types";

/** Pure English quick-add parser. See README.md for conflict and DST policies. */
export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAddResult {
  if (!Number.isFinite(ctx.now.getTime())) throw new RangeError("Invalid quick-add clock");
  const today = localCalendar(ctx.now, ctx.tz);
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
  for (const match of working.matchAll(
    /\S*[@#]\S*|https?:\/\/\S+|!\s*(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|an?)\s*(?:[mhd]|minutes?|hours?|days?)\s+before|\d{1,2}(?::\d{2})?\s*[ap]m|\d{1,2}:\d{2}(?::\d{2})?)\b/giu,
  )) {
    mask(match.index, match[0].length);
  }
  let recurrence: RecurrenceRule | undefined;
  for (const match of working.matchAll(recurrencePattern)) {
    mask(match.index, match[0].length);
    if (recurrence) continue;
    const rule = parseRecurrence(match[0]);
    if (!rule) continue;
    recurrence = rule;
    addSpan("recurrence", match.index, match[0].length);
  }
  if (recurrence) result.recurrence = recurrence;
  const parser = ctx.locale === "en-US" ? en.casual : en.GB;
  // A UTC surrogate supplies the injected zone's wall clock to chrono, independent of host TZ.
  const matches = parser
    .parse(working, { instant: today, timezone: 0 }, { forwardDate: true })
    .flatMap((candidate) => {
      const tags = candidate.start.tags();
      const elapsed = tags.has("result/relativeDateAndTime") || tags.has("casualReference/now");
      if (!elapsed && !candidate.start.isCertain("timezoneOffset")) return [candidate];
      // Durations inherit the reference offset; only other certain offsets are explicit tokens.
      // Reparse against the real clock so elapsed time and explicit-zone date inference agree.
      return parser
        .parse(
          candidate.text,
          {
            instant: ctx.now,
            timezone: elapsed ? 0 : Number(candidate.start.get("timezoneOffset")),
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
    const calendar = new Date(
      Date.UTC(Number(start.get("year")), Number(start.get("month")) - 1, Number(start.get("day"))),
    );
    // A lone time qualifies the recurrence's initial day, rather than changing its weekday.
    if (
      recurrence &&
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
    if (due) addSpan("due", match.index, match.text.length);
  } else if (recurrence) {
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
