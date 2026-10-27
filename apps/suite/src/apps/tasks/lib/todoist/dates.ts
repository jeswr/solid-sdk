// AUTHORED-BY Codex GPT-6.1-Sol
import { type TodoistDue, TodoistImportError } from "./model";

// IANA's single-component names/links. Intl also accepts unrelated abbreviations
// such as PST; accepting those would silently reinterpret the supplied zone.
const singleZones = new Set(
  "CET CST6CDT Cuba EET EST EST5EDT Egypt Eire Factory GB GB-Eire GMT GMT+0 GMT-0 GMT0 Greenwich HST Hongkong Iceland Iran Israel Jamaica Japan Kwajalein Libya MET MST MST7MDT NZ NZ-CHAT Navajo PRC PST8PDT Poland Portugal ROC ROK Singapore Turkey UCT UTC Universal W-SU WET Zulu"
    .split(" ")
    .map((zone) => zone.toLowerCase()),
);

export function zoneFormatter(zone: string, line: number): Intl.DateTimeFormat {
  if (
    typeof zone !== "string" ||
    (!singleZones.has(zone.toLowerCase()) && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(zone))
  ) {
    throw new TodoistImportError("INVALID_TIMEZONE", line);
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone.toLowerCase(),
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new TodoistImportError("INVALID_TIMEZONE", line);
  }
}

function wallAt(instant: number, format: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
  return Date.parse(
    `${(parts.year as string).padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
  );
}

function localInstant(wall: number, format: Intl.DateTimeFormat, line: number): number {
  // Obtain candidate offsets on both sides of a transition, then require an exact
  // round trip. Handles fractional-hour DST and whole-day date-line transitions.
  const second = Math.floor(wall / 1000) * 1000;
  const candidates = new Set<number>();
  for (const delta of [-172_800_000, -86_400_000, 0, 86_400_000, 172_800_000]) {
    const sample = second + delta;
    const candidate = second - (wallAt(sample, format) - sample);
    // A timezone offset can push even a guarded sample beyond year 9999.
    if (!Number.isFinite(candidate)) throw new TodoistImportError("INVALID_DATE", line);
    if (wallAt(candidate, format) === second) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new TodoistImportError("INVALID_DATE", line);
  return (candidates.values().next().value as number) + (wall - second);
}

/** Undefined means non-ISO text, which the caller must retain with a warning. */
export function parseDue(
  value: string,
  zone: string,
  format: Intl.DateTimeFormat,
  line: number,
): TodoistDue | undefined {
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      value,
    );
  if (!match || match[0] !== value) {
    // Unsupported ISO/basic/week/ordinal dates must not become natural-language dates.
    if (/^[+-]?\d{4}(?:$|[-+T\d])/.test(value)) throw new TodoistImportError("INVALID_DATE", line);
    return undefined;
  }
  const date = match[1] as string;
  const time = `${match[2] ?? "00"}:${match[3] ?? "00"}:${match[4] ?? "00"}${match[5] ?? ""}`;
  const wall = Date.parse(`${date}T${time}Z`);
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 19) !== `${date}T${time.slice(0, 8)}` ||
    date.startsWith("0000")
  ) {
    throw new TodoistImportError("INVALID_DATE", line);
  }
  let instant = wall;
  const offset = match[6];
  if (offset && offset !== "Z") {
    const hours = Number(offset.slice(1, 3));
    const minutes = Number(offset.slice(4));
    if (hours > 23 || minutes > 59 || offset === "-00:00")
      throw new TodoistImportError("INVALID_DATE", line);
    instant -= (offset[0] === "+" ? 1 : -1) * (hours * 60 + minutes) * 60_000;
  } else if (!offset) {
    // Intl's era-less formatting cannot safely represent a sample outside 1–9999.
    if (date < "0001-01-03" || date > "9999-12-29")
      throw new TodoistImportError("INVALID_DATE", line);
    instant = localInstant(wall, format, line);
  }
  const result = { dateTime: new Date(instant).toISOString(), timeZone: zone };
  return match[2] === undefined
    ? { ...result, kind: "date", date }
    : { ...result, kind: "dateTime" };
}
