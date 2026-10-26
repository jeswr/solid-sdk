// AUTHORED-BY Codex GPT-6.1-Sol
import { instantToWallClock, wallClockToInstant } from "../../../calendar/lib/tz";
import type { DoseWindow, DueDose, MedicationSchedule } from "./types";
import {
  DAY,
  dateDay,
  MedicationError,
  type ScheduleBounds,
  validateSchedule,
  validateWindow,
} from "./validation";

export function wallAt(at: number, timeZone: string): string {
  try {
    return instantToWallClock(at, timeZone).wallTime;
  } catch {
    throw new MedicationError("invalid-zoned-time");
  }
}

function dueAt(date: string, time: string, timeZone: string): number {
  try {
    // No implicit choice for a repeated time; gaps are never normalised.
    return wallClockToInstant(`${date}T${time}:00`, timeZone);
  } catch {
    throw new MedicationError("invalid-zoned-time");
  }
}

function eligible(
  schedule: MedicationSchedule,
  bounds: ScheduleBounds,
  day: number,
): schedule is Exclude<MedicationSchedule, { kind: "as-needed" }> {
  if (day < bounds.start || day > bounds.end) return false;
  switch (schedule.kind) {
    case "daily":
      return true;
    case "weekdays":
      return schedule.weekdays.includes(((day + 3) % 7) + 1);
    case "interval":
      return (day - bounds.start) % schedule.everyDays === 0;
    case "as-needed":
      return false;
  }
}

/** Validates a scheduled-dose reference, including DST ambiguity and seconds. */
export function isDue(
  schedule: MedicationSchedule,
  bounds: ScheduleBounds,
  at: number,
  timeZone: string,
): boolean {
  const wall = wallAt(at, timeZone);
  return (
    eligible(schedule, bounds, dateDay(wall.slice(0, 10))) &&
    schedule.times.includes(wall.slice(11, 16)) &&
    wall.endsWith(":00") &&
    dueAt(wall.slice(0, 10), wall.slice(11, 16), timeZone) === at
  );
}

/**
 * Wall-clock recurrence in the supplied IANA zone; never adds elapsed 24h to a
 * previous dose. Check the conservative local-date envelope for all supported
 * offsets (±14h), including dates briefly visited by a midnight rollback.
 */
export function generateDueDoses(
  schedule: MedicationSchedule,
  window: DoseWindow,
  timeZone: string,
): DueDose[] {
  const bounds = validateSchedule(schedule);
  validateWindow(window);
  wallAt(window.start, timeZone);
  if (window.start === window.end) return [];
  wallAt(window.end - 1000, timeZone);
  const first = Math.floor((window.start - 14 * 3600_000) / DAY);
  const last = Math.floor((window.end - 1000 + 14 * 3600_000) / DAY);
  const slots: { date: string; time: string }[] = [];
  for (let day = first; day <= last; day++) {
    if (!eligible(schedule, bounds, day)) continue;
    const date = new Date(day * DAY).toISOString().slice(0, 10);
    for (const time of schedule.times) {
      if (slots.length === 1024) throw new MedicationError("limit-exceeded");
      slots.push({ date, time });
    }
  }
  const doses: DueDose[] = [];
  for (const { date, time } of slots) {
    const scheduledAt = dueAt(date, time, timeZone);
    if (scheduledAt >= window.start && scheduledAt < window.end) {
      doses.push({ scheduleId: schedule.id, scheduledAt });
    }
  }
  return doses.sort((a, b) => a.scheduledAt - b.scheduledAt);
}
