// AUTHORED-BY Codex GPT-6.1-Sol

export type TimelineUnit = "day" | "month" | "year";

export interface TimelineOptions {
  unit: TimelineUnit;
  /** IANA zone understood by Intl; independent of the device's local time zone. */
  timeZone?: string;
  order?: "ascending" | "descending";
}

export interface TimelineGroup<T> {
  /** Gregorian YYYY, YYYY-MM or YYYY-MM-DD in the requested time zone. */
  key: string;
  items: T[];
}

/**
 * Sort instants and group by local calendar date. Ties retain input order; inputs
 * are never mutated. Invalid dates/zones and years outside 0001–9999 throw.
 * Date parsing and missing-date fallback belong to the caller.
 */
export function groupTimeline<T>(
  items: readonly T[],
  dateOf: (item: T) => Date | number,
  { unit, timeZone = "UTC", order = "descending" }: TimelineOptions,
): TimelineGroup<T>[] {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    era: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const direction = order === "ascending" ? 1 : -1;
  const sorted = items.map((item) => {
    const date = dateOf(item);
    const time = new Date(date instanceof Date ? date.getTime() : date).getTime();
    if (!Number.isFinite(time)) throw new RangeError("Timeline dates must be valid instants");
    return { item, time };
  });
  sorted.sort((a, b) => direction * (a.time - b.time));

  const groups = new Map<string, TimelineGroup<T>>();
  for (const { item, time } of sorted) {
    const { year, month, day, era } = Object.fromEntries(
      formatter.formatToParts(time).map(({ type, value }) => [type, value]),
    ) as { year: string; month: string; day: string; era: string };
    if (era !== "AD" || year.length > 4) {
      throw new RangeError("Timeline years must be between 0001 and 9999");
    }
    const date = `${year.padStart(4, "0")}-${month}-${day}`;
    const key = date.slice(0, { day: 10, month: 7, year: 4 }[unit]);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, items: [item] });
  }
  return [...groups.values()];
}
