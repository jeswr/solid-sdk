// AUTHORED-BY Codex GPT-6.1-Sol
import { assertInstant, CalendarTimeError, wallEpoch } from "./validation";

export type OverlapChoice = "earlier" | "later";
export interface ZonedTime {
  readonly wallTime: string;
  /** Signed local-minus-UTC offset; Kathmandu is +345. */
  readonly offsetMinutes: number;
}

function formatter(zone: string): Intl.DateTimeFormat {
  if (typeof zone !== "string" || zone === "" || /^[+-]/.test(zone)) {
    throw new CalendarTimeError("invalid-zone");
  }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
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
    throw new CalendarTimeError("invalid-zone");
  }
}

function wallAt(epoch: number, format: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(
    format.formatToParts(epoch).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Gregorian whole seconds in 2000–2099, independent of the host's local zone. */
export function instantToWallClock(instant: number, zone: string): ZonedTime {
  assertInstant(instant);
  const wallTime = wallAt(instant, formatter(zone));
  const offsetMinutes = (wallEpoch(wallTime) - instant) / 60_000;
  return { wallTime, offsetMinutes };
}

/**
 * Exhaustively match modern IANA minute offsets (±14h), rather than normalising a
 * gap or assuming all DST changes are one hour. No overlap choice is implicit.
 */
export function wallClockToInstant(
  wallTime: string,
  zone: string,
  overlap?: OverlapChoice,
): number {
  const local = wallEpoch(wallTime);
  const format = formatter(zone);
  if (overlap !== undefined && overlap !== "earlier" && overlap !== "later") {
    throw new CalendarTimeError("invalid-option");
  }
  const matches: number[] = [];
  for (let offset = 840; offset >= -840; offset--) {
    const candidate = local - offset * 60_000;
    if (wallAt(candidate, format) === wallTime) matches.push(candidate);
  }
  if (matches.length === 0) throw new CalendarTimeError("nonexistent-time");
  if (matches.length > 1 && overlap === undefined) throw new CalendarTimeError("ambiguous-time");
  // The exhaustive search orders candidates from earliest to latest.
  const result = matches[overlap === "later" ? matches.length - 1 : 0] as number;
  assertInstant(result);
  return result;
}

export interface SecondaryZoneTime extends ZonedTime {
  readonly primary: ZonedTime;
  /** Difference between secondary and primary clock readings, in minutes. */
  readonly differenceMinutes: number;
  /** Secondary calendar date relative to the primary date, including date-line changes. */
  readonly dayOffset: number;
}

export function secondaryZoneDisplay(
  instant: number,
  primaryZone: string,
  secondaryZone: string,
): SecondaryZoneTime {
  const primary = instantToWallClock(instant, primaryZone);
  const secondary = instantToWallClock(instant, secondaryZone);
  const day = (wallTime: string) => Date.parse(`${wallTime.slice(0, 10)}T00:00:00Z`);
  return {
    ...secondary,
    primary,
    differenceMinutes: secondary.offsetMinutes - primary.offsetMinutes,
    dayOffset: (day(secondary.wallTime) - day(primary.wallTime)) / 86_400_000,
  };
}
