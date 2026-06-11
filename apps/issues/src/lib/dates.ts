/**
 * Midnight UTC of the given instant's UTC calendar day. Due dates are
 * date-only values that parse to UTC midnight, so "overdue" must mean
 * "due on an earlier day" — comparing against the current instant would
 * mark an issue due today as overdue for the whole of its due date.
 */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
