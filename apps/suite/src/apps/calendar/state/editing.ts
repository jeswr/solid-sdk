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
  type StoredItem,
  wallClock,
} from "../lib/model";
import { asDate, validateEvent } from "../lib/model/validation";
import { EventQuickAddError, parseEventQuickAdd } from "../lib/quickadd";
import type { EventWrite } from "./repository";
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
  timeZone = master.timeZone ?? timeZone;
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
// AUTHORED-BY Claude Opus 5.5
/** The event mutation surface (`useEventMutations`) that series saves need. */
export interface SeriesMutations {
  /** A durable compound writer; false falls back to in-memory compensation. */
  compound?:
    | ((
        created: Extract<EventWrite, { kind: "create" }>,
        original: Exclude<EventWrite, { kind: "create" }>,
        replacement: SeriesReplacement,
      ) => Promise<boolean>)
    | undefined;
  resolve(url: string, etag: string | null, requireConfirmation?: boolean): Promise<string>;
  create(url: string, data: CalendarEvent, requireConfirmation?: boolean): Promise<void>;
  update(
    url: string,
    data: CalendarEvent,
    etag: string,
    requireConfirmation?: boolean,
  ): Promise<void>;
  delete(url: string, etag: string, requireConfirmation?: boolean): Promise<void>;
  /** Display a write without sending it; returns the function that removes the preview. */
  preview?(write: EventWrite): () => void;
}
/** A confirmed replacement created by an unfinished compound save; removed on failure/retry. */
export interface SeriesReplacement {
  current: { url: string; etag: string | null; durable?: boolean } | undefined;
}
export async function removeReplacement(
  mutations: SeriesMutations,
  replacement: SeriesReplacement,
): Promise<void> {
  const pending = replacement.current;
  if (!pending) return;
  if (!pending.durable) await mutations.delete(pending.url, pending.etag ?? "", true);
  replacement.current = undefined;
}
/**
 * Persist a `planSeriesEdit` plan (shared by the editor and drag-and-drop): any replacement
 * is confirmed before the original changes, and compound saves require confirmed prerequisites.
 */
export async function applySeriesPlan({
  plan,
  source,
  mode,
  target,
  mutations,
  replacement,
  newId = () => crypto.randomUUID(),
}: {
  plan: SeriesPlan;
  source: StoredItem<CalendarEvent>;
  mode: SeriesMode;
  target: CalendarInfo;
  mutations: SeriesMutations;
  replacement: SeriesReplacement;
  newId?: () => string;
}): Promise<void> {
  // Finish a failed compensation before retrying, so a retry cannot duplicate replacements.
  await removeReplacement(mutations, replacement);
  const create = async (event: CalendarEvent, compound: boolean) => {
    const url = new URL(`${newId()}.ttl`, target.container).href;
    await mutations.create(url, { ...event, uid: newId() }, compound);
    if (compound) {
      replacement.current = { url, etag: null };
      replacement.current.etag = await mutations.resolve(url, null);
    }
  };
  const moving =
    source.url &&
    plan.original &&
    plan.original.inCalendar !== source.data.inCalendar &&
    mode === "all";
  const compound = Boolean(plan.created || moving);
  // Compound operations require confirmed prerequisites; ordinary edits can stay queued offline.
  const etag = source.url ? await mutations.resolve(source.url, source.etag, compound) : "";
  // The replacement is written before the series changes; preview the series change at once
  // so the old occurrence doesn't sit beside its replacement while that write confirms.
  const release =
    compound && source.url
      ? mutations.preview?.(
          plan.original && !moving
            ? { kind: "update", url: source.url, data: plan.original, etag }
            : { kind: "delete", url: source.url, etag },
        )
      : undefined;
  const createdData = moving ? plan.original : plan.created;
  if (createdData && source.url && mutations.compound) {
    try {
      const handled = await mutations.compound(
        {
          kind: "create",
          url: new URL(`${newId()}.ttl`, target.container).href,
          data: { ...createdData, uid: newId() },
        },
        plan.original && !moving
          ? { kind: "update", url: source.url, data: plan.original, etag }
          : { kind: "delete", url: source.url, etag },
        replacement,
      );
      if (handled) {
        release?.();
        return;
      }
    } catch (error) {
      release?.();
      throw error;
    }
  }
  try {
    if (moving && plan.original) await create(plan.original, true);
    else if (plan.created) await create(plan.created, true);
    if (source.url) {
      if (plan.original && !moving)
        await mutations.update(source.url, plan.original, etag, compound);
      else await mutations.delete(source.url, etag, compound);
    } else if (plan.original) await create(plan.original, false);
  } catch (failure) {
    // Compensate before the preview goes, so the old occurrence never shows beside a
    // replacement; if that delete fails, `replacement` keeps it for the caller to retry.
    await removeReplacement(mutations, replacement).catch(() => undefined);
    throw failure;
  } finally {
    release?.();
  }
  replacement.current = undefined;
}
/** The latest local intent for an event: its item, null once deleted, undefined if none. */
export function localEventItem(
  url: string,
  writes: readonly EventWrite[],
): StoredItem<CalendarEvent> | null | undefined {
  const local = [...writes].reverse().find((w) => w.url === url);
  if (!local) return undefined;
  if (local.kind === "delete") return null;
  return {
    url,
    etag: local.confirmation?.etag ?? (local.kind === "update" ? local.etag : null),
    data: local.data,
  };
}
/** Fill a stored event's calendar from the container that holds it. */
export function withSourceCalendar(
  item: StoredItem<CalendarEvent>,
  calendars: readonly CalendarInfo[],
): StoredItem<CalendarEvent> {
  const source = calendars.find((c) => podScopedUrl(c.container, item.url, { allowRoot: false }));
  return {
    ...item,
    data: {
      ...item.data,
      inCalendar: item.data.inCalendar ?? (source ? `${source.url}#it` : undefined),
    },
  };
}
