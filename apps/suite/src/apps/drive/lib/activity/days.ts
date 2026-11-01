// AUTHORED-BY Codex GPT-6.1-Sol
import { orderedEvents } from "./activity";
import type { ChangeEvent, DayGroup } from "./types";
import { ActivityError, isText, requireValid } from "./validation";

/** Newest local day first, newest event first within each day (stream order for ties). */
export function groupActivityByDay(
  events: readonly ChangeEvent[],
  timeZone: string,
): DayGroup<ChangeEvent>[] {
  requireValid(isText(timeZone) && timeZone.trim() === timeZone, "invalid-time-zone");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new ActivityError("invalid-time-zone");
  }
  const groups = new Map<string, ChangeEvent[]>();
  for (const event of orderedEvents(events).sort((a, b) => b.at - a.at)) {
    const parts = Object.fromEntries(
      formatter.formatToParts(event.at).map(({ type, value }) => [type, value]),
    );
    const year = parts.year as string;
    requireValid(year.length <= 4, "invalid-time");
    const date = `${year.padStart(4, "0")}-${parts.month}-${parts.day}`;
    const items = groups.get(date);
    if (items) items.push(event);
    else groups.set(date, [event]);
  }
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items }));
}
