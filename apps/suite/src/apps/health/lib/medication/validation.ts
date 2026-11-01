// AUTHORED-BY Codex GPT-6.1-Sol
import type { DoseWindow, MedicationSchedule } from "./types";

export type MedicationErrorCode =
  | "invalid-schedule"
  | "invalid-date"
  | "invalid-instant"
  | "invalid-window"
  | "invalid-zoned-time"
  | "invalid-log"
  | "duplicate-log"
  | "limit-exceeded";

/** Stable codes and messages that never echo medication or caller data. */
export class MedicationError extends Error {
  constructor(public readonly code: MedicationErrorCode) {
    super(`Medication: ${code}`);
    this.name = "MedicationError";
  }
}

export const DAY = 86_400_000;
const MIN = Date.parse("2000-01-01T00:00:00Z");
const MAX = Date.parse("2100-01-01T00:00:00Z");

export function instant(value: number): void {
  if (!Number.isInteger(value) || value % 1000 !== 0 || value < MIN || value >= MAX) {
    throw new MedicationError("invalid-instant");
  }
}

export function dateDay(value: string): number {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) {
    throw new MedicationError("invalid-date");
  }
  const epoch = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) {
    throw new MedicationError("invalid-date");
  }
  return epoch / DAY;
}

export function shape(value: object, keys: readonly string[], code: MedicationErrorCode): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new MedicationError(code);
  }
}

export function validateWindow(window: DoseWindow): void {
  shape(window, ["start", "end"], "invalid-window");
  instant(window.start);
  instant(window.end);
  if (window.end < window.start) throw new MedicationError("invalid-window");
  if (window.end - window.start > 366 * DAY) throw new MedicationError("limit-exceeded");
}

export interface ScheduleBounds {
  readonly start: number;
  readonly end: number;
}

export function validateSchedule(schedule: MedicationSchedule): ScheduleBounds {
  shape(
    schedule,
    ["id", "startDate", "endDate", "kind", "times", "weekdays", "everyDays"],
    "invalid-schedule",
  );
  if (typeof schedule.id !== "string" || schedule.id.trim() === "") {
    throw new MedicationError("invalid-schedule");
  }
  const start = dateDay(schedule.startDate);
  const end = schedule.endDate === undefined ? dateDay("2099-12-31") : dateDay(schedule.endDate);
  if (end < start) throw new MedicationError("invalid-schedule");
  const baseKeys = ["id", "startDate", "endDate", "kind"];
  if (schedule.kind === "as-needed") {
    shape(schedule, baseKeys, "invalid-schedule");
    return { start, end };
  }
  if (
    !Array.isArray(schedule.times) ||
    schedule.times.length === 0 ||
    schedule.times.length > 24 ||
    new Set(schedule.times).size !== schedule.times.length
  ) {
    throw new MedicationError("invalid-schedule");
  }
  for (const time of schedule.times) {
    if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new MedicationError("invalid-schedule");
    }
  }
  switch (schedule.kind) {
    case "daily":
      shape(schedule, [...baseKeys, "times"], "invalid-schedule");
      break;
    case "weekdays":
      shape(schedule, [...baseKeys, "times", "weekdays"], "invalid-schedule");
      if (
        !Array.isArray(schedule.weekdays) ||
        schedule.weekdays.length === 0 ||
        new Set(schedule.weekdays).size !== schedule.weekdays.length
      ) {
        throw new MedicationError("invalid-schedule");
      }
      for (const weekday of schedule.weekdays) {
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
          throw new MedicationError("invalid-schedule");
        }
      }
      break;
    case "interval":
      shape(schedule, [...baseKeys, "times", "everyDays"], "invalid-schedule");
      if (!Number.isSafeInteger(schedule.everyDays) || schedule.everyDays < 1) {
        throw new MedicationError("invalid-schedule");
      }
      break;
    default:
      throw new MedicationError("invalid-schedule");
  }
  return { start, end };
}
