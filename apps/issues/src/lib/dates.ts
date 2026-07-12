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
 * dropped (floored) — worklog granularity is minutes in the UI, so a value is never
 * rounded UP into a minute it hasn't reached (which would overstate logged time).
 */
export function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Parse a free-text duration ("1h 30m", "90m", "1.5h", "45") into whole seconds, or
 * undefined if the input is not a well-formed, fully-recognised duration. Used by the
 * F4 log-work form; the form surfaces a clear error to the user on undefined.
 *
 * The contract is **strict, reject-on-invalid**: the ENTIRE trimmed string must match
 * the accepted grammar — either one-or-more `<number>h|m` terms (e.g. `1h 30m`,
 * `90m`, `1.5h`) or a single bare number read as minutes (e.g. `45`). Any leftover or
 * unsupported token rejects the whole input (returns undefined) rather than silently
 * logging a partial value: `1h 30`, `45abc`, `h`, and `1x` are all undefined.
 */
export function parseDuration(input: string): number | undefined {
  const text = input.trim().toLowerCase();
  if (!text) return undefined;

  // Grammar 1: one or more "<number><unit>" terms with optional whitespace between
  // them, anchored over the WHOLE string. ^\s* / \s*$ allow surrounding space; the
  // (?:...)+ requires at least one term and forbids any leftover/garbage token.
  const unitForm = /^\s*(?:(\d+(?:\.\d+)?)\s*(h|m)\s*)+$/;
  if (unitForm.test(text)) {
    let seconds = 0;
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(h|m)/g)) {
      const value = Number(m[1]);
      seconds += m[2] === "h" ? value * 3600 : value * 60;
    }
    return seconds > 0 ? Math.round(seconds) : undefined;
  }

  // Grammar 2: a single bare number (no unit suffix) is minutes. Number() — not
  // parseFloat — so trailing garbage like "45abc" yields NaN and rejects, instead of
  // parseFloat's lenient prefix scan reading it as 45.
  const bare = Number(text);
  if (!Number.isFinite(bare)) return undefined;
  const seconds = bare * 60;
  return seconds > 0 ? Math.round(seconds) : undefined;
}
