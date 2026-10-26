// AUTHORED-BY Codex GPT-6.1-Sol
import { CalendarLayoutError, compareId, eventIds, integer } from "./validation";

export interface TimedEvent {
  readonly id: string;
  /** Zero-based display day, already projected into the caller's timezone. */
  readonly day: number;
  /** Finite minutes in [0, 1440); fractional minutes are supported. */
  readonly startMinute: number;
  /** Exclusive, greater than startMinute and at most 1440. */
  readonly endMinute: number;
}

export interface TimedPlacement extends TimedEvent {
  column: number;
  columnCount: number;
  /** Horizontal fractions within the event's day, vertical fractions of 1440 minutes. */
  left: number;
  width: number;
  top: number;
  height: number;
}

/**
 * Day/week geometry, sorted by day/start/longest/id without mutating the input.
 * Greedy first-fit columns have equal width across each connected overlap cluster.
 * Separate clusters regain the full day width. No pixel sizing or minimum duration.
 * Overnight intervals must be split by the caller; invalid intervals are rejected.
 */
export function layoutTimeGrid(events: readonly TimedEvent[], dayCount: number): TimedPlacement[] {
  integer(dayCount, 1, 7);
  eventIds(events);
  for (const event of events) {
    integer(event.day, 0, dayCount - 1);
    if (
      !Number.isFinite(event.startMinute) ||
      !Number.isFinite(event.endMinute) ||
      event.startMinute < 0 ||
      event.endMinute > 1440 ||
      event.endMinute <= event.startMinute ||
      (event.endMinute - event.startMinute) / 1440 === 0
    ) {
      throw new CalendarLayoutError("invalid-range");
    }
  }
  const sorted = [...events].sort(
    (a, b) =>
      a.day - b.day ||
      a.startMinute - b.startMinute ||
      b.endMinute - a.endMinute ||
      compareId(a.id, b.id),
  );
  const placements: TimedPlacement[] = [];
  let cluster: TimedPlacement[] = [];
  let ends: number[] = [];
  let clusterDay = -1;
  let clusterEnd = -1;
  const flush = () => {
    for (const placement of cluster) {
      placement.columnCount = ends.length;
      placement.width = 1 / ends.length;
      placement.left = placement.column / ends.length;
      placements.push(placement);
    }
    cluster = [];
    ends = [];
  };
  for (const event of sorted) {
    if (event.day !== clusterDay || event.startMinute >= clusterEnd) flush();
    let column = ends.findIndex((end) => end <= event.startMinute);
    if (column === -1) column = ends.length;
    ends[column] = event.endMinute;
    cluster.push({
      id: event.id,
      day: event.day,
      startMinute: event.startMinute,
      endMinute: event.endMinute,
      column,
      columnCount: 0,
      left: 0,
      width: 0,
      top: event.startMinute / 1440,
      height: (event.endMinute - event.startMinute) / 1440,
    });
    clusterEnd = event.day === clusterDay ? Math.max(clusterEnd, event.endMinute) : event.endMinute;
    clusterDay = event.day;
  }
  flush();
  return placements;
}
