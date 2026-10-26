// AUTHORED-BY Codex GPT-6.1-Sol
import { check, fields } from "./errors";
import { matches, parseRule } from "./rule";
import { DAY, instant, local, Zone } from "./time";

export interface BusyInterval {
  readonly start: number;
  readonly end: number;
}

export interface RecurrenceInput {
  /** Local wall time, YYYY-MM-DDTHH:mm:ss, without offset. */
  readonly start: string;
  readonly timeZone: string;
  /** Fixed elapsed milliseconds (DTEND semantics, not nominal ICS DURATION). */
  readonly durationMs: number;
  readonly rrule?: string;
  /** Local wall times in timeZone, or YYYY-MM-DDTHH:mm:ssZ instants. */
  readonly exdates?: readonly string[];
  readonly rdates?: readonly string[];
  readonly maxOccurrences?: number;
}

export const MAX_OCCURRENCES = 10_000;
/** Bound work even for sparse, impossible, or very old rules. */
export const MAX_SCAN_DAYS = 366_000;

export function interval(value: BusyInterval): void {
  fields(value, ["start", "end"]);
  instant(value.start);
  instant(value.end);
  check(value.start < value.end, "invalid-input");
}

function dates(values: readonly string[], zone: Zone): Set<number> {
  check(Array.isArray(values), "invalid-input");
  check(values.length <= MAX_OCCURRENCES, "limit-exceeded");
  return new Set(Array.from(values, (value) => zone.explicit(value)));
}

/** Expand starts whose full intervals overlap [window.start, window.end).
 * COUNT applies before EXDATE and before window filtering; RDATE is independent.
 * A limit failure throws and never exposes a partial result.
 */
export function expandRecurrence(input: RecurrenceInput, window: BusyInterval): BusyInterval[] {
  fields(input, [
    "start",
    "timeZone",
    "durationMs",
    "rrule",
    "exdates",
    "rdates",
    "maxOccurrences",
  ]);
  interval(window);
  check(Number.isSafeInteger(input.durationMs) && input.durationMs > 0, "invalid-input");
  const cap = input.maxOccurrences === undefined ? MAX_OCCURRENCES : input.maxOccurrences;
  check(Number.isInteger(cap) && cap > 0 && cap <= MAX_OCCURRENCES, "invalid-input");
  const zone = new Zone(input.timeZone);
  const wall = local(input.start);
  const seed = zone.resolve(wall);
  check(seed !== undefined, "nonexistent-time");
  instant(seed + input.durationMs);
  const excluded = dates(input.exdates === undefined ? [] : input.exdates, zone);
  const included = dates(input.rdates === undefined ? [] : input.rdates, zone);
  const results = new Map<number, BusyInterval>();
  function add(start: number): void {
    const end = instant(start + input.durationMs);
    if (start < window.end && end > window.start && !excluded.has(start)) {
      results.set(start, { start, end });
      check(results.size <= cap, "limit-exceeded");
    }
  }
  // Validate explicit dates even when they lie outside the requested window.
  for (const date of included) add(date);
  if (input.rrule === undefined) {
    add(seed);
  } else {
    const rule = parseRule(input.rrule);
    const seedDay = Math.floor(wall / DAY);
    check(matches(seedDay, seedDay, rule) && seed <= rule.until, "start-mismatch");
    // Offsets can cross the date line; two days is a conservative UTC/wall margin.
    const lastDay = Math.min(
      Math.floor(local("9999-12-31T00:00:00") / DAY),
      Math.floor((Math.min(window.end, rule.until) + 2 * DAY) / DAY),
    );
    let count = 0;
    for (let day = seedDay; day <= lastDay && count < rule.count; day++) {
      check(day - seedDay < MAX_SCAN_DAYS, "limit-exceeded");
      if (!matches(day, seedDay, rule)) continue;
      const candidate = zone.resolve(day * DAY + wall - seedDay * DAY);
      if (candidate === undefined || candidate > rule.until) continue;
      count++;
      add(candidate);
    }
  }
  return [...results.values()].sort((a, b) => a.start - b.start);
}
