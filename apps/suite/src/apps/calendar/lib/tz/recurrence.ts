// AUTHORED-BY Codex GPT-6.1-Sol
import { instantToWallClock, type OverlapChoice, wallClockToInstant } from "./conversion";
import { assertInstant, CalendarTimeError, wallEpoch } from "./validation";

/** Timing only; metadata and persistence belong to the caller. */
export interface SeriesTiming {
  readonly id: string;
  readonly start: number;
  readonly durationMs: number;
  readonly zone: string;
  readonly overlap: OverlapChoice;
  /** Bare RRULE value, or null for a detached single event. */
  readonly rrule: string | null;
  readonly exdates: readonly number[];
}

export type SeriesEditScope = "this-event" | "this-and-following" | "all-events";
export interface SeriesEditPlan {
  /** Replace original timing, or remove the original when null. */
  readonly original: SeriesTiming | null;
  /** Create this explicitly identified event/series, when non-null. */
  readonly create: SeriesTiming | null;
}

interface Rule {
  frequency: "DAILY" | "WEEKLY";
  interval: number;
  count: number | null;
  until: number | null;
}

function positive(value: string): number {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > 36_600) {
    throw new CalendarTimeError("unsupported-rule");
  }
  return number;
}

function parseRule(value: string): Rule {
  if (typeof value !== "string") throw new CalendarTimeError("unsupported-rule");
  const parts = new Map<string, string>();
  for (const part of value.split(";")) {
    const match = /^(FREQ|INTERVAL|COUNT|UNTIL)=([^=]+)$/.exec(part);
    if (!match || parts.has(match[1] as string)) throw new CalendarTimeError("unsupported-rule");
    parts.set(match[1] as string, match[2] as string);
  }
  const frequency = parts.get("FREQ");
  if (frequency !== "DAILY" && frequency !== "WEEKLY") {
    throw new CalendarTimeError("unsupported-rule");
  }
  const count = parts.has("COUNT") ? positive(parts.get("COUNT") as string) : null;
  let until: number | null = null;
  if (parts.has("UNTIL")) {
    const match = /^(20\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(
      parts.get("UNTIL") as string,
    );
    if (!match || count !== null) throw new CalendarTimeError("unsupported-rule");
    until = wallEpoch(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`);
  }
  return {
    frequency,
    interval: parts.has("INTERVAL") ? positive(parts.get("INTERVAL") as string) : 1,
    count,
    until,
  };
}

function validate(timing: SeriesTiming): Rule | null {
  if (
    !timing ||
    typeof timing.id !== "string" ||
    timing.id.trim() === "" ||
    !Number.isSafeInteger(timing.durationMs) ||
    timing.durationMs <= 0 ||
    timing.durationMs % 1000 !== 0 ||
    !Array.isArray(timing.exdates) ||
    (timing.overlap !== "earlier" && timing.overlap !== "later")
  )
    throw new CalendarTimeError("invalid-series");
  assertInstant(timing.start);
  assertInstant(timing.start + timing.durationMs);
  const wall = instantToWallClock(timing.start, timing.zone).wallTime;
  if (wallClockToInstant(wall, timing.zone, timing.overlap) !== timing.start) {
    throw new CalendarTimeError("invalid-series");
  }
  const rule = timing.rrule === null ? null : parseRule(timing.rrule);
  if (rule !== null && rule.until !== null && rule.until < timing.start) {
    throw new CalendarTimeError("invalid-series");
  }
  const seen = new Set<number>();
  for (const date of timing.exdates) {
    assertInstant(date);
    if (!rule || seen.has(date)) throw new CalendarTimeError("invalid-series");
    occurrence(timing, rule, date);
    seen.add(date);
  }
  return rule;
}

/** Membership is Gregorian wall-clock arithmetic, never fixed elapsed-day arithmetic. */
function occurrence(timing: SeriesTiming, rule: Rule, instant: number): void {
  assertInstant(instant);
  const startWall = instantToWallClock(timing.start, timing.zone).wallTime;
  const selectedWall = instantToWallClock(instant, timing.zone).wallTime;
  const step = rule.interval * (rule.frequency === "WEEKLY" ? 7 : 1);
  const index = (wallEpoch(selectedWall) - wallEpoch(startWall)) / (step * 86_400_000);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    (rule.count !== null && index >= rule.count) ||
    (rule.until !== null && instant > rule.until) ||
    wallClockToInstant(selectedWall, timing.zone, timing.overlap) !== instant
  )
    throw new CalendarTimeError("invalid-occurrence");
  // COUNT excludes nonexistent local times in RFC 5545. Fail closed if a gap
  // lies before the selected occurrence, rather than silently miscounting it.
  if (rule.count !== null) {
    const anchor = wallEpoch(startWall);
    for (let i = 1; i < index; i++) {
      const wall = new Date(anchor + i * step * 86_400_000).toISOString().slice(0, 19);
      wallClockToInstant(wall, timing.zone, timing.overlap);
    }
  }
}

function copy(timing: SeriesTiming): SeriesTiming {
  return { ...timing, exdates: [...timing.exdates] };
}

/**
 * Complete replacements make rules, duration and exception migration explicit.
 * EXDATEs always identify ORIGINAL occurrence instants, even when the edit moves it.
 */
export function planSeriesEdit(
  series: SeriesTiming,
  scope: SeriesEditScope,
  selected: number,
  replacement: SeriesTiming,
): SeriesEditPlan {
  const rule = validate(series);
  validate(replacement);
  if (!rule) throw new CalendarTimeError("invalid-series");
  occurrence(series, rule, selected);
  if (series.exdates.includes(selected)) throw new CalendarTimeError("invalid-occurrence");
  if (scope === "all-events") {
    if (replacement.id !== series.id) throw new CalendarTimeError("invalid-series");
    return { original: copy(replacement), create: null };
  }
  if (replacement.id === series.id) throw new CalendarTimeError("invalid-series");
  if (scope === "this-event") {
    if (replacement.rrule !== null) throw new CalendarTimeError("invalid-series");
    return {
      original: { ...series, exdates: [...series.exdates, selected].sort((a, b) => a - b) },
      create: copy(replacement),
    };
  }
  if (scope !== "this-and-following") throw new CalendarTimeError("invalid-option");
  if (replacement.rrule === null) throw new CalendarTimeError("invalid-series");
  if (selected === series.start) return { original: null, create: copy(replacement) };
  // UNTIL is inclusive and UTC, and COUNT must not coexist with UNTIL (RFC 5545 §3.3.10).
  const until = `${new Date(selected - 1000).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  return {
    original: {
      ...series,
      rrule: `FREQ=${rule.frequency};INTERVAL=${rule.interval};UNTIL=${until}`,
      exdates: series.exdates.filter((date) => date < selected),
    },
    create: copy(replacement),
  };
}
