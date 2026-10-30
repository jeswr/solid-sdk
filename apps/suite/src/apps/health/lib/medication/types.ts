// AUTHORED-BY Codex GPT-6.1-Sol
interface ScheduleBase {
  readonly id: string;
  /** Inclusive local Gregorian date, YYYY-MM-DD. */
  readonly startDate: string;
  readonly endDate?: string;
}

export type MedicationSchedule = ScheduleBase &
  (
    | { readonly kind: "daily"; readonly times: readonly string[] }
    | {
        readonly kind: "weekdays";
        readonly times: readonly string[];
        /** ISO weekdays: Monday=1, Sunday=7. */
        readonly weekdays: readonly number[];
      }
    | {
        readonly kind: "interval";
        readonly times: readonly string[];
        /** Local calendar days, anchored to startDate. */
        readonly everyDays: number;
      }
    | { readonly kind: "as-needed" }
  );

/** Half-open UTC instant window [start, end), in Unix milliseconds. */
export interface DoseWindow {
  readonly start: number;
  readonly end: number;
}

/** The pair (scheduleId, scheduledAt) is the stable scheduled-dose identity. */
export interface DueDose {
  readonly scheduleId: string;
  readonly scheduledAt: number;
}

export interface DoseEntry {
  /** null only for an as-needed event. */
  readonly scheduledAt: number | null;
  readonly at: number;
  readonly outcome: "taken" | "skipped";
}

export interface DoseLog {
  readonly scheduleId: string;
  readonly scheduledAt: number | null;
  readonly at: number;
  readonly status: "taken" | "skipped" | "late";
}

export interface AdherencePeriod extends DoseWindow {
  readonly expected: number;
  /** Taken at or before the due instant, excluding late. */
  readonly taken: number;
  readonly late: number;
  readonly skipped: number;
  readonly missed: number;
  /** (taken + late) / expected * 100; null when expected is zero. */
  readonly adherencePercent: number | null;
  readonly onTimePercent: number | null;
}
