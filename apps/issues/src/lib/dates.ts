/**
 * Midnight UTC of the given instant's UTC calendar day. Due dates are
 * date-only values that parse to UTC midnight, so "overdue" must mean
 * "due on an earlier day" — comparing against the current instant would
 * mark an issue due today as overdue for the whole of its due date.
 */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Format a duration in seconds as a compact "Xh Ym" string for the F4 time-tracking
 * UI (e.g. 5400 → "1h 30m", 1800 → "30m", 0 → "0m"). Sub-minute remainders are
 * dropped — worklog granularity is minutes in the UI.
 */
export function formatDuration(totalSeconds: number): string {
  const mins = Math.round(totalSeconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Parse a free-text duration ("1h 30m", "90m", "1.5h", "45") into whole seconds, or
 * undefined if it has no parseable magnitude. Used by the F4 log-work form. A bare
 * number is read as minutes (the form's default unit).
 */
export function parseDuration(input: string): number | undefined {
  const text = input.trim().toLowerCase();
  if (!text) return undefined;
  let seconds = 0;
  let matched = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(h|m)/g)) {
    matched = true;
    const value = Number.parseFloat(m[1]);
    seconds += m[2] === "h" ? value * 3600 : value * 60;
  }
  if (!matched) {
    // No unit suffix: a bare number is minutes.
    const bare = Number.parseFloat(text);
    if (!Number.isFinite(bare)) return undefined;
    seconds = bare * 60;
  }
  return seconds > 0 ? Math.round(seconds) : undefined;
}
