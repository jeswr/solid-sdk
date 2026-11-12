// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { isomorphic } from "rdf-isomorphic";
import { buildEvent, type CalendarDate, type CalendarEvent, validateEvent } from "../lib/model";
import type { EventWrite } from "./repository";

export interface OutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError("Invalid calendar intent");
  return value as Record<string, unknown>;
}
function date(value: unknown): CalendarDate {
  if (typeof value !== "string") throw new TypeError("Invalid calendar date");
  if (value.length === 10) return value;
  const at = new Date(value);
  if (at.toISOString() !== value) throw new TypeError("Invalid calendar instant");
  return at;
}
/** Revive model fields only, after validating the JSON schema. */
export function decodeEvent(value: unknown): CalendarEvent {
  const raw = object(value, [
    "name",
    "start",
    "end",
    "timeZone",
    "location",
    "description",
    "inCalendar",
    "uid",
    "recurrence",
    "reminders",
  ]);
  for (const field of ["name", "timeZone", "location", "description", "inCalendar", "uid"])
    if (raw[field] !== undefined && typeof raw[field] !== "string")
      throw new TypeError("Invalid calendar text");
  let recurrence: CalendarEvent["recurrence"];
  if (raw.recurrence !== undefined) {
    const rule = object(raw.recurrence, [
      "frequency",
      "interval",
      "count",
      "until",
      "byDay",
      "byMonthDay",
      "byMonth",
      "exceptDate",
    ]);
    for (const field of ["byDay", "byMonthDay", "byMonth", "exceptDate"])
      if (rule[field] !== undefined && !Array.isArray(rule[field]))
        throw new TypeError("Invalid recurrence array");
    recurrence = {
      ...rule,
      until: rule.until === undefined ? undefined : date(rule.until),
      exceptDate: (rule.exceptDate as unknown[] | undefined)?.map(date),
    } as CalendarEvent["recurrence"];
  }
  if (raw.reminders !== undefined && !Array.isArray(raw.reminders))
    throw new TypeError("Invalid reminders");
  const reminders = (raw.reminders as unknown[] | undefined)?.map((entry) => {
    const reminder = object(entry, ["triggerOffset", "triggerTime"]);
    if (reminder.triggerOffset !== undefined && typeof reminder.triggerOffset !== "string")
      throw new TypeError("Invalid reminder");
    const triggerTime = reminder.triggerTime === undefined ? undefined : date(reminder.triggerTime);
    if (typeof triggerTime === "string") throw new TypeError("Invalid reminder instant");
    return { triggerOffset: reminder.triggerOffset as string | undefined, triggerTime };
  });
  const data = {
    ...raw,
    start: date(raw.start),
    end: raw.end === undefined ? undefined : date(raw.end),
    recurrence,
    reminders,
  } as CalendarEvent;
  validateEvent(data);
  return data;
}
export function strongEventEtag(value: unknown): value is string {
  return typeof value === "string" && /^"[^"\r\n]*"$/.test(value);
}
export function reviveEventWrite(value: unknown): EventWrite {
  const raw = object(value, ["kind", "url", "data", "etag"]);
  if (typeof raw.url !== "string" || !["create", "update", "delete"].includes(String(raw.kind)))
    throw new TypeError("Invalid calendar write");
  if (raw.kind !== "create" && !strongEventEtag(raw.etag))
    throw new TypeError("Reload this event before saving");
  if (raw.kind === "delete") {
    if (raw.data !== undefined) throw new TypeError("Invalid calendar delete");
    return { kind: "delete", url: raw.url, etag: raw.etag as string };
  }
  if (raw.kind === "create" && raw.etag !== undefined)
    throw new TypeError("Invalid calendar create");
  const data = decodeEvent(raw.data);
  return raw.kind === "create"
    ? { kind: "create", url: raw.url, data }
    : { kind: "update", url: raw.url, data, etag: raw.etag as string };
}
export function matchesEvent(document: { dataset: DatasetCore }, url: string, data: CalendarEvent) {
  return isomorphic([...document.dataset], [...buildEvent(url, data)]);
}
