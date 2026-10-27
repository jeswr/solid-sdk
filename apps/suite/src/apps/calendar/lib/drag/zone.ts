// AUTHORED-BY Codex GPT-6.1-Sol
import { CalendarDragError, check, checkEpoch, type OverlapChoice } from "./types";

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

interface Resolved {
  instant: number;
  dstAdjusted: boolean;
}

/** Intl is the only source of zone rules. UTC dates are coordinates for local arithmetic. */
export class Zone {
  private readonly format: Intl.DateTimeFormat;

  constructor(name: string) {
    check(typeof name === "string" && name.length > 0 && !/^[+-]/.test(name), "UNKNOWN_TIME_ZONE");
    try {
      this.format = new Intl.DateTimeFormat("en-GB", {
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
        fractionalSecondDigits: 3,
        hourCycle: "h23",
      });
    } catch {
      throw new CalendarDragError("UNKNOWN_TIME_ZONE");
    }
  }

  wall(instant: number): number {
    const parts = Object.fromEntries(
      this.format.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    const date = new Date(0);
    const year = Number(parts.year);
    date.setUTCFullYear(
      parts.era === "BC" ? 1 - year : year,
      Number(parts.month) - 1,
      Number(parts.day),
    );
    date.setUTCHours(
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      Number(parts.fractionalSecond),
    );
    return date.getTime();
  }

  resolve(wall: number, preferredOffset: number, overlap?: OverlapChoice): Resolved {
    checkEpoch(wall);
    // The four-day neighbourhood includes both sides of IANA date-line jumps,
    // half-hour DST changes and historical offsets with seconds. Work is fixed
    // regardless of the gesture size; never walk the requested minutes/days.
    const offsets = new Set<number>();
    for (let delta = -2 * DAY_MS; delta <= 2 * DAY_MS; delta += DAY_MS / 4) {
      const probe = wall + delta;
      offsets.add(this.wall(probe) - probe);
    }
    const projected = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b);
    const matches = projected.filter((candidate) => this.wall(candidate) === wall);
    if (matches.length > 0) {
      const preferred = matches.find((candidate) => wall - candidate === preferredOffset);
      check(
        overlap !== undefined || preferred !== undefined || matches.length === 1,
        "AMBIGUOUS_TIME",
      );
      const instant =
        overlap === "later"
          ? (matches[matches.length - 1] as number)
          : overlap === "earlier"
            ? (matches[0] as number)
            : (preferred ?? (matches[0] as number));
      checkEpoch(instant);
      return { instant, dstAdjusted: false };
    }

    // A nonexistent wall time lies between the projections using the offsets
    // before/after its forward transition. Bisect to the transition itself,
    // rather than shifting by the gap length (02:30 must become 03:00).
    let low = projected[0] as number;
    let high = projected[projected.length - 1] as number;
    check(this.wall(low) < wall && this.wall(high) > wall, "INVALID_RANGE");
    while (high - low > 1) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.wall(middle) < wall) low = middle;
      else high = middle;
    }
    checkEpoch(high);
    return { instant: high, dstAdjusted: true };
  }
}
