// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { check, RecurrenceError } from "./errors";

export const DAY = 86_400_000;
const MIN = -62_135_596_800_000; // 0001-01-01T00:00:00Z
const MAX = 253_402_300_799_999; // 9999-12-31T23:59:59.999Z

export function instant(value: number): number {
  check(Number.isSafeInteger(value) && value >= MIN && value <= MAX, "invalid-date");
  return value;
}

/** UTC is only a coordinate system for Gregorian wall-clock arithmetic. */
export function utc(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

export function local(value: string): number {
  check(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value),
    "invalid-date",
  );
  const time = instant(Date.parse(`${value}Z`));
  check(new Date(time).toISOString() === `${value}.000Z`, "invalid-date");
  return time;
}

export function utcDate(value: string): number {
  check(typeof value === "string" && /^\d{8}T\d{6}Z$/i.test(value), "invalid-rule");
  const v = value.toUpperCase();
  return local(
    `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}`,
  );
}

export class Zone {
  private readonly formatter: Intl.DateTimeFormat;

  constructor(name: string) {
    check(typeof name === "string" && name.length > 0 && !/^[+-]/.test(name), "invalid-zone");
    try {
      this.formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: name,
        calendar: "gregory",
        numberingSystem: "latn",
        era: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      throw new RecurrenceError("invalid-zone");
    }
  }

  private wall(time: number): number {
    const parts = Object.fromEntries(
      this.formatter.formatToParts(time).map((p) => [p.type, p.value]),
    );
    let year = Number(parts.year);
    if (parts.era === "BC") year = 1 - year;
    return (
      utc(year, Number(parts.month), Number(parts.day)) +
      (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000
    );
  }

  /** Test surrounding offsets, round-trip every candidate, choose the first fold instant.
   * The four-day neighbourhood also covers whole-day date-line transitions.
   * Callers validate the supported instant range after filtering generated starts.
   */
  resolve(wall: number): number | undefined {
    const offsets = new Set<number>();
    for (let delta = -2 * DAY; delta <= 2 * DAY; delta += DAY / 4) {
      const probe = wall + delta;
      offsets.add(this.wall(probe) - probe);
    }
    const candidates = [...offsets]
      .map((offset) => wall - offset)
      .filter((candidate) => this.wall(candidate) === wall);
    if (candidates.length === 0) return undefined;
    return Math.min(...candidates);
  }

  explicit(value: string): number {
    check(typeof value === "string", "invalid-date");
    if (value.endsWith("Z")) return local(value.slice(0, -1));
    const result = this.resolve(local(value));
    check(result !== undefined, "nonexistent-time");
    return instant(result);
  }
}
