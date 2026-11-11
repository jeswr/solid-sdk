// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { PlacesSnapshot } from "./model.js";
export type Period = { start: Date; end: Date };
export function periodBounds(value: string): Period {
  if (!/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(value) || Number(value.slice(0, 4)) < 100)
    throw new TypeError("Choose a valid month or year");
  const start = new Date(`${value.length === 4 ? `${value}-01` : value}-01T00:00:00`);
  const end = new Date(start);
  if (value.length === 4) end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return { start, end };
}
export function dayBounds(day: string): Period {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError("Choose a valid date");
  const start = new Date(`${day}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || localDay(start) !== day)
    throw new TypeError("Choose a valid date");
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
function overlaps(start: Date, end: Date, period: Period) {
  return (
    start < period.end &&
    end >= start &&
    (end > period.start || (+start === +end && start >= period.start))
  );
}
export function timelineForDay(snapshot: PlacesSnapshot, day: string) {
  const period = dayBounds(day);
  return [
    ...snapshot.visits.map((record) => ({ kind: "visit" as const, ...record })),
    ...snapshot.journeys.map((record) => ({ kind: "journey" as const, ...record })),
  ]
    .filter((record) => overlaps(record.data.startTime, record.data.endTime, period))
    .sort(
      (a, b) =>
        a.data.startTime.getTime() - b.data.startTime.getTime() || a.url.localeCompare(b.url),
    );
}
/** ISO calendar day in the browser's local zone; storage remains UTC. */
export function localDay(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}
/** Local day keys, sorted, without expanding untrusted multi-year spans into days. */
export function groupByDay(snapshot: PlacesSnapshot) {
  const groups = new Map<string, ReturnType<typeof timelineForDay>>();
  const rows = [
    ...snapshot.visits.map((record) => ({ kind: "visit" as const, ...record })),
    ...snapshot.journeys.map((record) => ({ kind: "journey" as const, ...record })),
  ].sort((a, b) => a.data.startTime.getTime() - b.data.startTime.getTime());
  for (const row of rows) {
    const day = localDay(row.data.startTime);
    let group = groups.get(day);
    if (!group) {
      group = [];
      groups.set(day, group);
    }
    group.push(row);
  }
  return groups;
}
export function placeVisitIndex(snapshot: PlacesSnapshot) {
  const result = new Map<string, { count: number; last: Date }>();
  for (const { data } of snapshot.visits) {
    const before = result.get(data.place);
    result.set(data.place, {
      count: (before?.count ?? 0) + 1,
      last: before && before.last > data.startTime ? before.last : data.startTime,
    });
  }
  return result;
}
export function periodStats(snapshot: PlacesSnapshot, period: Period) {
  if (!(period.start < period.end)) throw new TypeError("Invalid period");
  const seen = new Set<string>();
  let visitCount = 0;
  for (const { data } of snapshot.visits)
    if (overlaps(data.startTime, data.endTime, period)) {
      seen.add(data.place);
      visitCount++;
    }
  const distanceByMode: Record<string, number> = {};
  for (const { data } of snapshot.journeys) {
    if (!overlaps(data.startTime, data.endTime, period)) continue;
    const length = data.endTime.getTime() - data.startTime.getTime();
    const part = Math.max(
      0,
      Math.min(+data.endTime, +period.end) - Math.max(+data.startTime, +period.start),
    );
    const fraction = length === 0 ? 1 : part / length;
    distanceByMode[data.activityType] =
      (distanceByMode[data.activityType] ?? 0) + data.distance * fraction;
  }
  return { placesVisited: seen.size, visits: visitCount, distanceByMode };
}
export function mapLinks(latitude: number, longitude: number) {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    throw new TypeError("Invalid map coordinates");
  const params = new URLSearchParams({
    bbox: [
      Math.max(-180, longitude - 0.01),
      Math.max(-90, latitude - 0.01),
      Math.min(180, longitude + 0.01),
      Math.min(90, latitude + 0.01),
    ].join(","),
    layer: "mapnik",
    marker: `${latitude},${longitude}`,
  });
  return {
    open: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
    embed: `https://www.openstreetmap.org/export/embed.html?${params}`,
  };
}
