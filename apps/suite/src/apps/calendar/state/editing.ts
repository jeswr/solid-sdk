// AUTHORED-BY Codex GPT-6.1-Sol
import { podScopedUrl } from "@jeswr/guarded-fetch";
import { decodeRef, encodeRef } from "../../../lib/refs";
import {
  type CalendarDate,
  type CalendarEvent,
  expandEvent,
  fromWallClock,
  importICal,
  type RecurrenceRule,
  wallClock,
} from "../lib/model";
import { asDate, validateEvent } from "../lib/model/validation";
import { EventQuickAddError, parseEventQuickAdd } from "../lib/quickadd";
import type { CalendarInfo } from "./view";

export function eventDocument(
  url: string,
  pod: string,
  calendars: readonly CalendarInfo[],
): string {
  const parsed = new URL(url);
  if (
    parsed.hash ||
    parsed.search ||
    parsed.pathname.endsWith("/") ||
    !podScopedUrl(pod, url, { allowRoot: false }) ||
    !calendars.some((c) => podScopedUrl(c.container, url, { allowRoot: false }))
  )
    throw new TypeError("Event is outside your calendars");
  return parsed.href;
}
export function decodeEventRef(
  ref: string,
  pod: string,
  calendars: readonly CalendarInfo[],
): string {
  return eventDocument(decodeRef(ref), pod, calendars);
}
export function editorHref(url: string, start: CalendarDate, returnTo: string): string {
  return `/calendar/e/${encodeRef(url)}?${new URLSearchParams({ occurrence: typeof start === "string" ? start : start.toISOString(), return: returnTo })}`;
}
export function quickDraft(
  title: string,
  slot: CalendarEvent,
  now: Date,
  tz: string,
): CalendarEvent {
  try {
    const parsed = parseEventQuickAdd(title, { now, tz });
    const start = parsed.allDay ? parsed.start : new Date(parsed.start);
    const end = parsed.end
      ? parsed.allDay
        ? parsed.end
        : new Date(parsed.end)
      : parsed.allDay
        ? new Date(+asDate(start) + 86400000).toISOString().slice(0, 10)
        : new Date(+asDate(start) + 3600000);
    const recurrence = parsed.rrule
      ? importICal(
          `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:quick\nSUMMARY:Quick\nDTSTART;VALUE=DATE:20261101\nRRULE:${parsed.rrule}\nEND:VEVENT\nEND:VCALENDAR`,
        ).events[0]?.recurrence
      : undefined;
    return {
      ...slot,
      name: parsed.title,
      start,
      end,
      location: parsed.location,
      recurrence,
    };
  } catch (error) {
    if (
      error instanceof EventQuickAddError &&
      (error.code === "missing-date" || error.code === "missing-title")
    )
      return { ...slot, name: title.trim() };
    throw error;
  }
}
export type SeriesMode = "this" | "following" | "all";
export interface SeriesPlan {
  original: CalendarEvent | null;
  created?: CalendarEvent;
}
/** Match the editor's inclusive civil end date to the DTSTART kind, at second precision. */
export function editorRecurrence(
  rule: RecurrenceRule | undefined,
  start: CalendarDate,
  timeZone: string,
): RecurrenceRule | undefined {
  if (!rule || rule.until === undefined) return rule;
  const until =
    typeof start === "string"
      ? typeof rule.until === "string"
        ? rule.until
        : wallClock(rule.until, timeZone).toISOString().slice(0, 10)
      : typeof rule.until === "string"
        ? fromWallClock(new Date(+asDate(rule.until) + 86399000), timeZone)
        : rule.until;
  return { ...rule, until };
}
/** Pure plan; persist any replacement before touching the original. */
export function planSeriesEdit(
  master: CalendarEvent,
  occurrence: CalendarDate,
  edited: CalendarEvent | null,
  mode: SeriesMode,
  timeZone: string,
): SeriesPlan {
  if (edited) validateEvent(edited);
  const rule = master.recurrence;
  if (!rule) return { original: edited };
  validateEvent(master);
  const at = asDate(occurrence);
  // Civil dates have no UTC offset. Interpret them in the target timed zone on conversion.
  const floating = (date: CalendarDate) =>
    typeof date === "string" ? asDate(date) : wallClock(date, timeZone);
  const delta = edited ? +floating(edited.start) - +floating(occurrence) : 0;
  const shift = (date: CalendarDate): CalendarDate => {
    const wall = new Date(+floating(date) + delta);
    return typeof edited?.start === "string"
      ? wall.toISOString().slice(0, 10)
      : fromWallClock(wall, timeZone);
  };
  const shiftedRule = (event: CalendarEvent, exceptions = event.recurrence?.exceptDate) =>
    event.recurrence ? { ...event.recurrence, exceptDate: exceptions?.map(shift) } : undefined;
  const generated = expandEvent(
    { ...master, recurrence: { ...rule, exceptDate: [] } },
    asDate(master.start),
    new Date(+at + 1),
    timeZone,
  );
  const index = generated.findIndex((e) => +asDate(e.start) === +at);
  if (index < 0) throw new TypeError("Occurrence is outside this series");
  if (mode === "all") {
    if (!edited) return { original: null };
    const start = shift(master.start);
    const duration =
      edited.end === undefined ? undefined : +asDate(edited.end) - +asDate(edited.start);
    const end =
      duration === undefined
        ? undefined
        : typeof start === "string"
          ? new Date(+asDate(start) + duration).toISOString().slice(0, 10)
          : new Date(+asDate(start) + duration);
    return {
      original: { ...edited, start, end, recurrence: shiftedRule(edited), uid: master.uid },
    };
  }
  if (mode === "this")
    return {
      original: {
        ...master,
        recurrence: { ...rule, exceptDate: [...(rule.exceptDate ?? []), occurrence] },
      },
      ...(edited ? { created: { ...edited, uid: undefined, recurrence: undefined } } : {}),
    };
  const zone = typeof occurrence === "string" ? "UTC" : timeZone;
  const day = wallClock(at, zone).toISOString().slice(0, 10);
  const until =
    typeof occurrence === "string"
      ? new Date(+asDate(day) - 86400000).toISOString().slice(0, 10)
      : new Date(Math.floor(+at / 1000) * 1000 - 1000);
  const original =
    index === 0 ? null : { ...master, recurrence: { ...rule, count: undefined, until } };
  if (!edited) return { original };
  const nextRule = edited.recurrence;
  return {
    original,
    created: {
      ...edited,
      uid: undefined,
      recurrence: nextRule
        ? {
            ...nextRule,
            count:
              nextRule.count !== undefined && nextRule.count === rule.count
                ? nextRule.count - index
                : nextRule.count,
            exceptDate: (nextRule.exceptDate ?? rule.exceptDate)
              ?.filter((ex) => +asDate(ex) >= +at)
              .map(shift),
          }
        : undefined,
    },
  };
}
