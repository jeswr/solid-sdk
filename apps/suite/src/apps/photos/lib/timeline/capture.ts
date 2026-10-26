// AUTHORED-BY Codex GPT-6.1-Sol
import {
  calendarDate,
  instant,
  offsetMinutes,
  PhotoTimelineError,
  requireTimeline,
} from "./validation";

export interface TimelinePhoto {
  readonly id: string;
  /** Epoch milliseconds, or YYYY-MM-DDTHH:mm:ss[.SSS](Z|±HH:mm). */
  readonly capturedAt: number | string;
  /** Preserved capture offset, overriding the supplied zone. Must agree with an ISO suffix. */
  readonly captureOffset?: string;
}

export interface ResolvedPhoto<T> {
  photo: T;
  time: number;
  date: string;
}

export function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  requireTimeline(typeof timeZone === "string" && timeZone.trim() !== "", "invalid-time-zone");
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new PhotoTimelineError("invalid-time-zone");
  }
}

function parseCapture(value: number | string): { time: number; offset?: number } {
  if (typeof value === "number") {
    instant(value);
    return { time: value };
  }
  requireTimeline(typeof value === "string", "invalid-capture-time");
  // Deliberately reject unresolved local times, leap seconds, 24:00, and excess precision.
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  requireTimeline(match, "invalid-capture-time");
  const date = match[1] as string;
  try {
    calendarDate(date);
  } catch {
    throw new PhotoTimelineError("invalid-capture-time");
  }
  const offset = offsetMinutes(match[6] as string);
  const time = Date.parse(value);
  instant(time);
  return { time, offset };
}

export function resolvePhotos<T extends TimelinePhoto>(
  photos: readonly T[],
  formatter: Intl.DateTimeFormat,
): ResolvedPhoto<T>[] {
  requireTimeline(Array.isArray(photos), "invalid-photo");
  const ids = new Set<string>();
  // Array.from also validates holes instead of silently dropping them during map/sort.
  return Array.from(photos, (photo) => {
    requireTimeline(
      photo && typeof photo.id === "string" && photo.id.trim() !== "",
      "invalid-photo",
    );
    requireTimeline(!ids.has(photo.id), "duplicate-id");
    ids.add(photo.id);
    const capture = parseCapture(photo.capturedAt);
    const offset =
      photo.captureOffset === undefined ? capture.offset : offsetMinutes(photo.captureOffset);
    requireTimeline(capture.offset === undefined || offset === capture.offset, "invalid-offset");
    let date: string;
    if (offset !== undefined) {
      const local = capture.time + offset * 60_000;
      instant(local);
      date = new Date(local).toISOString().slice(0, 10);
    } else {
      const parts = Object.fromEntries(
        formatter.formatToParts(capture.time).map(({ type, value }) => [type, value]),
      ) as { year: string; month: string; day: string; era: string };
      requireTimeline(parts.era === "AD" && parts.year.length <= 4, "invalid-capture-time");
      date = `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
    }
    return { photo, time: capture.time, date };
  });
}
