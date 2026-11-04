// AUTHORED-BY Claude Opus 5.5
/**
 * Requested durations (ODRL `elapsedTime`, an ISO 8601 duration) and expiry dates mapped onto the
 * ConsentSheet's duration chips, and a chip choice mapped back to the `expiresAt` sent to decide().
 * Calendar arithmetic is in local time, like the date the user picks.
 */

export type DurationChoice = "until-revoked" | "day" | "month" | "year" | "custom";

export interface DurationParts {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const ISO_DURATION =
  /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** Whole-unit ISO 8601 durations only; anything else (fractions, negatives, junk) is undefined. */
export function parseDuration(value: string | undefined): DurationParts | undefined {
  const match = value === undefined ? null : ISO_DURATION.exec(value.trim());
  if (!match) return undefined;
  const [years, months, weeks, days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => (part === undefined ? 0 : Number(part)));
  const parts = { years, months, weeks, days, hours, minutes, seconds } as DurationParts;
  const amounts = Object.values(parts);
  // A zero duration asks for nothing; absurd values would overflow Date arithmetic.
  return amounts.some((part) => part > 0) && amounts.every((part) => part <= 100_000)
    ? parts
    : undefined;
}

export function addDuration(from: Date, parts: DurationParts): Date {
  const date = new Date(from.getTime());
  date.setFullYear(date.getFullYear() + parts.years, date.getMonth() + parts.months);
  date.setDate(date.getDate() + parts.weeks * 7 + parts.days);
  date.setHours(
    date.getHours() + parts.hours,
    date.getMinutes() + parts.minutes,
    date.getSeconds() + parts.seconds,
  );
  return date;
}

function only(parts: DurationParts, unit: keyof DurationParts, value: number): boolean {
  return Object.entries(parts).every(([key, amount]) => amount === (key === unit ? value : 0));
}

/** The chip a requested duration corresponds to exactly, if any. */
export function chipFor(parts: DurationParts): Exclude<DurationChoice, "custom"> | undefined {
  if (only(parts, "days", 1) || only(parts, "hours", 24)) return "day";
  if (only(parts, "months", 1)) return "month";
  if (only(parts, "years", 1) || only(parts, "months", 12)) return "year";
  return undefined;
}

const UNITS: readonly [keyof DurationParts, string][] = [
  ["years", "year"],
  ["months", "month"],
  ["weeks", "week"],
  ["days", "day"],
  ["hours", "hour"],
  ["minutes", "minute"],
  ["seconds", "second"],
];

/** "1 month", "2 weeks and 3 days". */
export function durationText(parts: DurationParts): string {
  const words = UNITS.filter(([key]) => parts[key] > 0).map(
    ([key, unit]) => `${parts[key]} ${unit}${parts[key] === 1 ? "" : "s"}`,
  );
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words.join("");
}

/** `YYYY-MM-DD` in local time, the value of a date input. */
export function dateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The end (local) of a date input's day, or undefined for an invalid date. */
export function endOfDateInput(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined;
}

export interface DurationSelection {
  value: DurationChoice;
  customDate: string;
}

/**
 * Preselect what the request asked for: its requested duration (an exact chip, or a custom date
 * that far ahead), else a future requested expiry date, else "Until revoked".
 */
export function initialDuration(
  request: { requestedDuration?: string; expiresAt?: string },
  now: Date,
): DurationSelection {
  const parts = parseDuration(request.requestedDuration);
  if (parts) {
    const chip = chipFor(parts);
    const end = addDuration(now, parts);
    return { value: chip ?? "custom", customDate: dateInputValue(end) };
  }
  const expires = request.expiresAt === undefined ? Number.NaN : Date.parse(request.expiresAt);
  if (expires > now.getTime())
    return { value: "custom", customDate: dateInputValue(new Date(expires)) };
  return { value: "until-revoked", customDate: "" };
}

/**
 * The decision's `expiresAt`: undefined for "Until revoked"; `null` when a custom date is missing,
 * invalid or not in the future (Share stays disabled).
 */
export function expiresAtFor(selection: DurationSelection, now: Date): Date | undefined | null {
  switch (selection.value) {
    case "until-revoked":
      return undefined;
    case "day":
      return addDuration(now, { ...ZERO, days: 1 });
    case "month":
      return addDuration(now, { ...ZERO, months: 1 });
    case "year":
      return addDuration(now, { ...ZERO, years: 1 });
    case "custom": {
      const end = endOfDateInput(selection.customDate);
      return end && end > now ? end : null;
    }
  }
}

const ZERO: DurationParts = {
  years: 0,
  months: 0,
  weeks: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
};

/** The list row's "requested duration" text. */
export function requestedDurationText(
  request: { requestedDuration?: string; expiresAt?: string },
  formatDate: (value: string) => string,
): string {
  const parts = parseDuration(request.requestedDuration);
  if (parts) return `For ${durationText(parts)}`;
  if (request.expiresAt !== undefined && Number.isFinite(Date.parse(request.expiresAt)))
    return `Until ${formatDate(request.expiresAt)}`;
  return "Until revoked";
}
