// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { instantToWallClock, wallClockToInstant } from "../tz/conversion";
import { type CalendarTimeError, wallEpoch } from "../tz/validation";
import { readClauses } from "./clauses";
import { type EventDraft, type EventQuickAddContext, reject } from "./types";

function addDays(date: string, days: number, input: string): string {
  const epoch = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  if (
    !Number.isFinite(epoch) ||
    epoch < Date.parse("2000-01-01T00:00:00Z") ||
    epoch >= Date.parse("2100-01-01T00:00:00Z")
  ) {
    reject("invalid-date", input);
  }
  return new Date(epoch).toISOString().slice(0, 10);
}

function instant(date: string, time: string, tz: string, input: string): number {
  try {
    return wallClockToInstant(`${date}T${time}`, tz);
  } catch (error) {
    // Zone and clock are checked before parsing. Preserve the precise DST reason.
    const code = (error as CalendarTimeError).code;
    reject(code === "ambiguous-time" || code === "nonexistent-time" ? code : "invalid-date", input);
  }
}

function occurrenceIsPast(
  wallTime: string,
  context: EventQuickAddContext,
  nowWallTime: string,
): boolean {
  try {
    // An overlap is wholly past only after its later instant has passed. The
    // selected occurrence still goes through strict conversion below.
    return wallClockToInstant(wallTime, context.tz, "later") < context.now.getTime();
  } catch (error) {
    // A gap has no instant; skip it only once its local wall time is past.
    // Other errors are left for strict conversion to report.
    return (error as CalendarTimeError).code === "nonexistent-time" && wallTime < nowWallTime;
  }
}

/** Bounded English scheduling grammar; throws EventQuickAddError on any uncertainty. */
export function parseEventQuickAdd(input: string, context: EventQuickAddContext): EventDraft {
  if (typeof input !== "string") reject("invalid-input", "");
  if (input.length > 4096 || !input.trim()) reject("invalid-input", input);
  if (!context || !(context.now instanceof Date) || !Number.isFinite(context.now.getTime())) {
    reject("invalid-context", input);
  }
  let nowWallTime: string;
  const now = Math.floor(context.now.getTime() / 1000) * 1000;
  try {
    nowWallTime = instantToWallClock(now, context.tz).wallTime;
  } catch {
    reject("invalid-context", input);
  }
  const today = nowWallTime.slice(0, 10);
  const clauses = readClauses(input);
  const { time, endTime, duration, rrule } = clauses;
  if ((clauses.allDay && time) || (endTime && (!time || duration))) {
    reject("conflicting-fields", input);
  }
  if (!clauses.date && !rrule) reject("missing-date", input);
  let date = clauses.date ?? today;
  if (date === "today") date = today;
  else if (date === "tomorrow") date = addDays(today, 1, input);
  try {
    wallEpoch(`${date}T00:00:00`);
  } catch {
    reject("invalid-date", input);
  }
  const weekdays =
    clauses.weekdays ??
    (rrule === "FREQ=WEEKLY" ? [new Date(`${date}T00:00:00Z`).getUTCDay()] : undefined);
  const matchesDay = (value: string): boolean =>
    !weekdays || weekdays.includes(new Date(`${value}T00:00:00Z`).getUTCDay());
  if (clauses.date && !matchesDay(date)) reject("conflicting-fields", input);
  const allDay = !time;
  if (duration && allDay !== duration.days) reject("invalid-duration", input);
  if (!clauses.date) {
    // At most a week: supported rules are daily or weekly with one or more days.
    while (!matchesDay(date)) date = addDays(date, 1, input);
    if (time && occurrenceIsPast(`${date}T${time}`, context, nowWallTime)) {
      date = addDays(date, 1, input);
      while (!matchesDay(date)) date = addDays(date, 1, input);
    }
  }
  const start = time ? instant(date, time, context.tz, input) : undefined;
  let end: string | undefined;
  let durationMinutes = duration?.minutes;
  if (start !== undefined) {
    let endInstant: number | undefined;
    if (endTime) endInstant = instant(date, endTime, context.tz, input);
    else if (duration) endInstant = start + duration.minutes * 60_000;
    if (endInstant !== undefined) {
      if (endInstant <= start) reject("conflicting-fields", input);
      try {
        instantToWallClock(endInstant, context.tz);
      } catch {
        reject("invalid-date", input);
      }
      end = new Date(endInstant).toISOString();
      durationMinutes = (endInstant - start) / 60_000;
    }
  } else if (duration) end = addDays(date, duration.minutes / 1440, input);
  return {
    title: clauses.title,
    start: start === undefined ? date : new Date(start).toISOString(),
    allDay,
    timeZone: context.tz,
    ...(end === undefined ? {} : { end }),
    ...(durationMinutes === undefined ? {} : { durationMinutes }),
    ...(clauses.location === undefined ? {} : { location: clauses.location }),
    ...(rrule === undefined ? {} : { rrule }),
  };
}
