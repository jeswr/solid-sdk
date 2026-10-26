// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Calendar-only port of Pod Manager ical.ts: TEXT escaping, unfolding and UTF-8 folding.
import { RRule } from "rrule";
import { fromWallClock } from "./recurrence";
import type { CalendarDate, CalendarEvent, RecurrenceRule, Reminder, Weekday } from "./types";
import { asDate, durationMilliseconds, validateEvent, validateRule } from "./validation";

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, ch: string) => (ch.toLowerCase() === "n" ? "\n" : ch));
}
export function foldContentLine(line: string): string {
  let result = "",
    bytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += ch;
    bytes += size;
  }
  return result;
}
export function formatICalDate(value: CalendarDate): string {
  asDate(value);
  return typeof value === "string"
    ? value.replace(/-/g, "")
    : value
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
}
export function parseICalDate(value: string, timeZone = "UTC"): CalendarDate {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!m) throw new TypeError("Invalid ICS date");
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  asDate(date);
  if (!m[4]) return date;
  const wall = new Date(`${date}T${m[4]}:${m[5]}:${m[6]}.000Z`);
  if (!Number.isFinite(+wall) || wall.toISOString().slice(11, 19) !== `${m[4]}:${m[5]}:${m[6]}`)
    throw new TypeError("Invalid ICS time");
  return m[7] ? wall : fromWallClock(wall, timeZone);
}
export function ruleToICal(rule: RecurrenceRule): string {
  validateRule(rule);
  const parts = [`FREQ=${rule.frequency}`];
  if (rule.interval !== undefined) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${formatICalDate(rule.until)}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.byMonthDay?.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  return parts.join(";");
}
function ruleFromICal(value: string, timeZone: string): RecurrenceRule {
  // Reject fields the shared shape cannot represent, rather than silently changing a series.
  const bag = new Map(
    value
      .toUpperCase()
      .split(";")
      .map((p) => {
        const [k, v] = p.split("=");
        return [k, v] as const;
      }),
  );
  for (const key of bag.keys())
    if (
      !["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH"].includes(
        key as string,
      )
    )
      throw new TypeError("Unsupported RRULE field");
  RRule.parseString(value);
  const numbers = (key: string) => bag.get(key)?.split(",").map(Number);
  const rule: RecurrenceRule = {
    frequency: bag.get("FREQ") as RecurrenceRule["frequency"],
    interval: bag.has("INTERVAL") ? Number(bag.get("INTERVAL")) : undefined,
    count: bag.has("COUNT") ? Number(bag.get("COUNT")) : undefined,
    until: bag.has("UNTIL") ? parseICalDate(bag.get("UNTIL") as string, timeZone) : undefined,
    byDay: bag.get("BYDAY")?.split(",") as Weekday[] | undefined,
    byMonthDay: numbers("BYMONTHDAY"),
    byMonth: numbers("BYMONTH"),
  };
  validateRule(rule);
  return rule;
}
export interface ExportItem {
  data: CalendarEvent;
  url?: string;
}
export function exportICal(opts: {
  events: readonly (CalendarEvent | ExportItem)[];
  now?: Date;
  timeZone?: string;
}): string {
  const zone = opts.timeZone ?? "UTC";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Solid Suite//Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  const prop = (name: string, value: string) => lines.push(`${name}:${escapeText(value)}`);
  const dateProp = (name: string, value: CalendarDate) => {
    if (typeof value === "string") lines.push(`${name};VALUE=DATE:${formatICalDate(value)}`);
    else {
      // We cannot supply VTIMEZONE definitions or encode later overlap instants
      // in local ICS time. Reject instead of changing a named-zone schedule.
      if (zone !== "UTC")
        throw new TypeError("Named-zone ICS export requires unsupported VTIMEZONE definitions");
      lines.push(`${name}:${formatICalDate(value)}`);
    }
  };
  for (const item of opts.events) {
    const { data: event, url } = "data" in item ? item : { data: item, url: undefined };
    validateEvent(event);
    const uid = event.uid ?? url;
    if (!uid?.trim()) throw new TypeError("ICS export requires a persistent UID or source URL");
    lines.push("BEGIN:VEVENT");
    prop("UID", uid);
    lines.push(`DTSTAMP:${formatICalDate(opts.now ?? new Date())}`);
    prop("SUMMARY", event.name);
    dateProp("DTSTART", event.start);
    if (event.end !== undefined) dateProp("DTEND", event.end);
    if (event.location !== undefined) prop("LOCATION", event.location);
    if (event.description !== undefined) prop("DESCRIPTION", event.description);
    if (event.recurrence) {
      if (
        event.recurrence.until !== undefined &&
        typeof event.recurrence.until !== typeof event.start
      )
        throw new TypeError("ICS DTSTART and UNTIL must use the same date kind");
      lines.push(`RRULE:${ruleToICal(event.recurrence)}`);
      for (const date of event.recurrence.exceptDate ?? []) {
        if (typeof date !== typeof event.start)
          throw new TypeError("ICS DTSTART and EXDATE must use the same date kind");
        dateProp("EXDATE", date);
      }
    }
    for (const reminder of event.reminders ?? []) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY");
      prop("DESCRIPTION", event.name);
      if (reminder.triggerOffset !== undefined) {
        const offset = reminder.triggerOffset;
        const milliseconds = durationMilliseconds(offset);
        // Model days/weeks are fixed lengths; ICS days/weeks are nominal.
        const duration = /[DW]/.test(offset)
          ? `${milliseconds < 0 ? "-" : ""}PT${Math.abs(milliseconds) / 1000}S`
          : offset;
        lines.push(`TRIGGER:${duration}`);
      } else lines.push(`TRIGGER;VALUE=DATE-TIME:${formatICalDate(reminder.triggerTime as Date)}`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldContentLine).join("\r\n")}\r\n`;
}
interface Property {
  name: string;
  params: string;
  value: string;
}
export interface ImportedICal {
  events: CalendarEvent[];
  /** TZID contexts aligned with events. Keep alongside the series until timezone persistence is specified. */
  timeZones: (string | undefined)[];
  warnings: string[];
  skipped: number;
}
/** Unsupported overrides skip every component with that UID; other unsupported semantics skip the event. */
export function importICal(text: string, floatingTimeZone = "UTC"): ImportedICal {
  const result: ImportedICal = { events: [], timeZones: [], warnings: [], skipped: 0 };
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n[ \t]|\n[ \t]/g, "")
    .split(/\r?\n/);
  const stack: string[] = [];
  const components: { properties: Property[]; alarms: Property[][] }[] = [];
  let event: Property[] = [],
    alarms: Property[][] = [],
    alarm: Property[] = [];
  for (const line of lines) {
    const match = /^([^:;]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!match) continue;
    const property = {
      name: (match[1] as string).toUpperCase(),
      params: match[2] as string,
      value: match[3] as string,
    };
    const component = property.value.toUpperCase();
    if (property.name === "BEGIN") {
      stack.push(component);
      if (component === "VTIMEZONE")
        result.warnings.push(
          "Custom VTIMEZONE definitions are unsupported; using Intl timezone data",
        );
      if (component === "VEVENT") {
        event = [];
        alarms = [];
      }
      if (component === "VALARM") alarm = [];
      continue;
    }
    if (property.name === "END") {
      if (stack.pop() !== component) {
        result.warnings.push("Mismatched ICS component");
        continue;
      }
      if (component === "VALARM" && stack.at(-1) === "VEVENT") alarms.push(alarm);
      if (component === "VEVENT") {
        components.push({ properties: event, alarms });
      }
      continue;
    }
    if (stack.at(-1) === "VEVENT") event.push(property);
    if (stack.at(-1) === "VALARM") alarm.push(property);
  }
  if (stack.length) result.warnings.push("Unclosed ICS component");
  const uid = (properties: Property[]) => {
    const value = properties.find((p) => p.name === "UID")?.value;
    return value === undefined ? undefined : unescapeText(value);
  };
  const overridden = new Set(
    components
      .filter(({ properties }) => properties.some((p) => p.name === "RECURRENCE-ID"))
      .map(({ properties }) => uid(properties))
      .filter((value) => value !== undefined),
  );
  for (const { properties, alarms } of components) {
    try {
      const seriesUid = uid(properties);
      if (seriesUid !== undefined && overridden.has(seriesUid))
        throw new TypeError("Unsupported ICS recurrence override; skipped entire series");
      const parsed = parseEventProperties(properties, alarms, floatingTimeZone);
      result.events.push(parsed.event);
      result.timeZones.push(parsed.timeZone);
    } catch (error) {
      result.skipped++;
      result.warnings.push((error as Error).message);
    }
  }
  return result;
}
function parseEventProperties(
  properties: Property[],
  alarms: Property[][],
  floatingTimeZone: string,
): { event: CalendarEvent; timeZone: string | undefined } {
  const get = (name: string) => properties.find((p) => p.name === name);
  if (get("STATUS")?.value.toUpperCase() === "CANCELLED")
    throw new TypeError("Cancelled ICS event skipped");
  if (properties.some((p) => ["RDATE", "EXRULE", "RECURRENCE-ID", "DURATION"].includes(p.name)))
    throw new TypeError("Unsupported ICS event property");
  const start = get("DTSTART");
  if (!start) throw new TypeError("ICS event needs DTSTART");
  const zone = (p: Property) => /(?:^|;)TZID="?([^;"\r\n]+)"?/i.exec(p.params)?.[1];
  const date = (p: Property): CalendarDate => {
    const value = parseICalDate(p.value, zone(p) ?? floatingTimeZone);
    if (/(?:^|;)VALUE=DATE(?:;|$)/i.test(p.params) !== (typeof value === "string"))
      throw new TypeError("ICS date kind mismatch");
    return value;
  };
  const rule = get("RRULE");
  const recurrence = rule ? ruleFromICal(rule.value, zone(start) ?? floatingTimeZone) : undefined;
  const exceptions = properties
    .filter((p) => p.name === "EXDATE")
    .flatMap((p) => p.value.split(",").map((value) => date({ ...p, value })));
  if (exceptions.length && !recurrence) throw new TypeError("EXDATE needs a recurrence rule");
  if (recurrence) recurrence.exceptDate = exceptions;
  const reminders: Reminder[] = alarms.map((props) => {
    const trigger = props.find((p) => p.name === "TRIGGER");
    if (
      !trigger ||
      /RELATED=END/i.test(trigger.params) ||
      props.some((p) => ["REPEAT", "DURATION"].includes(p.name))
    )
      throw new TypeError("Unsupported ICS alarm");
    if (props.find((p) => p.name === "ACTION")?.value !== "DISPLAY")
      throw new TypeError("Unsupported ICS alarm action");
    if (/VALUE=DATE-TIME/i.test(trigger.params)) {
      const value = parseICalDate(trigger.value);
      if (typeof value === "string") throw new TypeError("Absolute alarm needs an instant");
      return { triggerTime: value };
    }
    if (/[DW]/.test(trigger.value))
      throw new TypeError("Unsupported nominal day/week ICS alarm duration");
    return { triggerOffset: trigger.value };
  });
  const end = get("DTEND");
  const event: CalendarEvent = {
    name: unescapeText(get("SUMMARY")?.value ?? ""),
    start: date(start),
    end: end ? date(end) : undefined,
    location: get("LOCATION") && unescapeText((get("LOCATION") as Property).value),
    description: get("DESCRIPTION") && unescapeText((get("DESCRIPTION") as Property).value),
    uid: get("UID") && unescapeText((get("UID") as Property).value),
    recurrence,
    reminders,
  };
  validateEvent(event);
  return { event, timeZone: zone(start) };
}
