// AUTHORED-BY Codex GPT-6.1-Sol
import { timestamp } from "./validation";

export type BucketPeriod = "day" | "week" | "month";
export interface BucketOptions {
  readonly period: BucketPeriod;
  readonly timeZone: string;
}

/** Internal UTC Date is a calendar-arithmetic carrier, never a bucket's real instant. */
export function calendarDate(key: string): Date {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(key) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== key
  ) {
    throw new RangeError("Expected a valid Gregorian YYYY-MM-DD date");
  }
  return date;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function floorDate(date: Date, period: BucketPeriod): Date {
  if (period === "week") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (period === "month") date.setUTCDate(1);
  return date;
}

export function nextDate(date: Date, period: BucketPeriod): void {
  if (period === "month") date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCDate(date.getUTCDate() + (period === "week" ? 7 : 1));
}

export function createBucketer({ period, timeZone }: BucketOptions): (at: number) => string {
  if (!["day", "week", "month"].includes(period)) throw new RangeError("Unsupported period");
  // No implicit machine timezone, even when called from untyped JavaScript.
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    throw new RangeError("An explicit timezone is required");
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    era: "short",
  });
  return (at) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(timestamp(at)).map((p) => [p.type, p.value]),
    );
    if (parts.era !== "AD" || Number(parts.year) > 9999) {
      throw new RangeError("Expected a local calendar year from 0001 to 9999");
    }
    const key = `${String(parts.year).padStart(4, "0")}-${parts.month}-${parts.day}`;
    return dateKey(floorDate(calendarDate(key), period));
  };
}

/** Start date in the requested timezone; ISO weeks start Monday. */
export function bucketKey(at: number, options: BucketOptions): string {
  return createBucketer(options)(at);
}
