// AUTHORED-BY Codex GPT-6
import type { DateTimeValue } from "@jeswr/suite-ui/date-time";

/** Date-only readings use today's current instant, otherwise local noon. */
export function measurementTime(value: DateTimeValue | null, now = new Date()): string {
  if (!value) return "";
  if (value.kind === "dateTime") return value.dateTime;
  const date = new Date(`${value.date}T12:00:00`);
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
    // Preserve the exact instant even during a repeated hour at the end of DST.
    return now.toISOString();
  return date.toISOString();
}
