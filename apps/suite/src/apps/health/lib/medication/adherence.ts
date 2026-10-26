// AUTHORED-BY Codex GPT-6.1-Sol
import { generateDueDoses, isDue, wallAt } from "./schedule";
import type { AdherencePeriod, DoseEntry, DoseLog, DoseWindow, MedicationSchedule } from "./types";
import { dateDay, instant, MedicationError, shape, validateSchedule } from "./validation";

function checkedLogs(
  schedule: MedicationSchedule,
  timeZone: string,
  logs: readonly DoseLog[],
): DoseLog[] {
  const bounds = validateSchedule(schedule);
  // Validate the zone even when no logs exist.
  wallAt(Date.parse("2026-01-01T12:00:00Z"), timeZone);
  if (!Array.isArray(logs)) throw new MedicationError("invalid-log");
  const seen = new Set<number>();
  const result: DoseLog[] = [];
  for (const log of logs) {
    shape(log, ["scheduleId", "scheduledAt", "at", "status"], "invalid-log");
    instant(log.at);
    if (log.scheduleId !== schedule.id) throw new MedicationError("invalid-log");
    if (schedule.kind === "as-needed") {
      const day = dateDay(wallAt(log.at, timeZone).slice(0, 10));
      if (
        log.scheduledAt !== null ||
        log.status !== "taken" ||
        day < bounds.start ||
        day > bounds.end
      ) {
        throw new MedicationError("invalid-log");
      }
    } else {
      instant(log.scheduledAt as number);
      if (
        !isDue(schedule, bounds, log.scheduledAt as number, timeZone) ||
        (log.status !== "skipped" &&
          log.status !== (log.at > (log.scheduledAt as number) ? "late" : "taken"))
      ) {
        throw new MedicationError("invalid-log");
      }
    }
    const key = log.scheduledAt === null ? log.at : log.scheduledAt;
    if (seen.has(key)) throw new MedicationError("duplicate-log");
    seen.add(key);
    result.push({
      scheduleId: log.scheduleId,
      scheduledAt: log.scheduledAt,
      at: log.at,
      status: log.status,
    });
  }
  return result;
}

/** Append immutably; a second outcome for the same dose is an error. */
export function logDose(
  schedule: MedicationSchedule,
  timeZone: string,
  logs: readonly DoseLog[],
  entry: DoseEntry,
): DoseLog[] {
  validateSchedule(schedule);
  shape(entry, ["scheduledAt", "at", "outcome"], "invalid-log");
  if (entry.outcome !== "taken" && entry.outcome !== "skipped") {
    throw new MedicationError("invalid-log");
  }
  instant(entry.at);
  if (entry.scheduledAt !== null) instant(entry.scheduledAt);
  if (!Array.isArray(logs)) throw new MedicationError("invalid-log");
  const status =
    entry.outcome === "skipped"
      ? "skipped"
      : entry.scheduledAt !== null && entry.at > entry.scheduledAt
        ? "late"
        : "taken";
  return checkedLogs(schedule, timeZone, [
    ...logs,
    { scheduleId: schedule.id, scheduledAt: entry.scheduledAt, at: entry.at, status },
  ]);
}

/**
 * Group by due instant, not the logging date. `asOf` makes retrospective results
 * deterministic: exclude future expectations and ignore outcomes recorded later.
 * Periods may overlap and are returned in caller order, without rounding.
 */
export function adherenceByPeriod(
  schedule: MedicationSchedule,
  timeZone: string,
  logs: readonly DoseLog[],
  periods: readonly DoseWindow[],
  asOf: number,
): AdherencePeriod[] {
  instant(asOf);
  const checked = checkedLogs(schedule, timeZone, logs);
  if (!Array.isArray(periods)) throw new MedicationError("invalid-window");
  const outcomes = new Map(
    checked.filter((log) => log.at <= asOf).map((log) => [log.scheduledAt, log.status]),
  );
  return Array.from(periods, (period) => {
    const due = generateDueDoses(schedule, period, timeZone).filter(
      (dose) => dose.scheduledAt <= asOf,
    );
    let taken = 0;
    let late = 0;
    let skipped = 0;
    for (const dose of due) {
      switch (outcomes.get(dose.scheduledAt)) {
        case "taken":
          taken++;
          break;
        case "late":
          late++;
          break;
        case "skipped":
          skipped++;
          break;
      }
    }
    const expected = due.length;
    return {
      start: period.start,
      end: period.end,
      expected,
      taken,
      late,
      skipped,
      missed: expected - taken - late - skipped,
      adherencePercent: expected === 0 ? null : ((taken + late) / expected) * 100,
      onTimePercent: expected === 0 ? null : (taken / expected) * 100,
    };
  });
}
