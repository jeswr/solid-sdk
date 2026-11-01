// AUTHORED-BY Claude Opus 5.5
import { applyDrag, SNAP_MINUTES } from "../lib/drag";
import { asDate, type CalendarEvent, fromWallClock, wallClock } from "../lib/model";

/** The time grid draws 48px per hour. */
export const PX_PER_MINUTE = 0.8;
/** One time-grid slot; pointer moves and resizes snap to it. */
export const GRID_SNAP_MINUTES = 30;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type DragKind = "move" | "resize-end";
export interface DragGesture {
  kind: DragKind;
  /** Signed vertical change in whole minutes. */
  minutes: number;
  /** Signed civil-day change. */
  days: number;
}
export interface Column {
  left: number;
}

/** A small dead zone keeps clicks (and finger jitter on touch) from becoming drags. */
export function dragThreshold(pointerType: string): number {
  return pointerType === "touch" ? 10 : 4;
}
export function passedThreshold(dx: number, dy: number, pointerType: string): boolean {
  return Math.hypot(dx, dy) >= dragThreshold(pointerType);
}
export function pointerMinutes(dy: number): number {
  return Math.round(dy / PX_PER_MINUTE) || 0;
}
/** The column under `x` (left-to-right, gaps belong to the left column), clamped; -1 if none. */
export function columnAt(x: number, columns: readonly Column[]): number {
  if (!columns.length) return -1;
  let index = 0;
  columns.forEach((column, i) => {
    if (x >= column.left) index = i;
  });
  return index;
}
/** Whole civil days from one YYYY-MM-DD key to another. */
export function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
/** The largest snap the pointer library accepts that keeps this wall time exactly. */
function exactSnap(wall: Date): number | undefined {
  const offset = +wall - Math.floor(+wall / DAY_MS) * DAY_MS;
  return [...SNAP_MINUTES].reverse().find((step) => offset % (step * MINUTE_MS) === 0);
}
/** Whether two event timings (start and end, timed or all-day) are identical. */
export function sameTiming(a: CalendarEvent, b: CalendarEvent): boolean {
  const time = (value: CalendarEvent["start"] | undefined) =>
    value === undefined ? undefined : typeof value === "string" ? value : +value;
  return time(a.start) === time(b.start) && time(a.end) === time(b.end);
}

/**
 * Apply a pointer gesture to an event's timing through the shared drag maths.
 * Returns undefined for a no-op or a gesture the drag maths rejects.
 */
export function draggedEvent(
  event: CalendarEvent,
  gesture: DragGesture,
  timeZone: string,
  snapMinutes = GRID_SNAP_MINUTES,
): CalendarEvent | undefined {
  try {
    let next: CalendarEvent;
    if (typeof event.start === "string") {
      // Floating dates: calendar-date arithmetic in UTC, like series planning.
      if (gesture.kind !== "move") return undefined;
      const start = Date.parse(`${event.start}T00:00:00Z`);
      const end =
        typeof event.end === "string" ? Date.parse(`${event.end}T00:00:00Z`) : start + DAY_MS;
      const result = applyDrag({
        start,
        end,
        timeZone: "UTC",
        kind: "move",
        deltaMinutes: 0,
        dayDelta: gesture.days,
        snapMinutes: GRID_SNAP_MINUTES,
        allDay: true,
      });
      const key = (value: number) => new Date(value).toISOString().slice(0, 10);
      next = {
        ...event,
        start: key(result.start),
        end: event.end === undefined ? undefined : key(result.end),
      };
    } else {
      const start = asDate(event.start);
      const end = event.end === undefined ? +start + snapMinutes * MINUTE_MS : +asDate(event.end);
      const wall = wallClock(start, timeZone);
      const snap = exactSnap(wall);
      let result: { start: number; end: number };
      if (gesture.kind === "move" && gesture.minutes === 0 && snap === undefined) {
        // Off-grid times keep their exact wall-clock time on a day-only move.
        const moved = +fromWallClock(
          new Date(+wall + gesture.days * DAY_MS),
          timeZone,
          "offset-before",
        );
        result = { start: moved, end: moved + (end - +start) };
      } else
        result = applyDrag({
          start: +start,
          end,
          timeZone,
          kind: gesture.kind,
          deltaMinutes: gesture.minutes,
          dayDelta: gesture.kind === "move" ? gesture.days : 0,
          // A day-only move keeps the time of day; vertical moves snap to the grid.
          snapMinutes:
            gesture.kind === "move" && gesture.minutes === 0 ? (snap as number) : snapMinutes,
        });
      next = {
        ...event,
        start: new Date(result.start),
        end: event.end === undefined && gesture.kind === "move" ? undefined : new Date(result.end),
      };
    }
    return sameTiming(next, event) ? undefined : next;
  } catch {
    // CalendarDragError (or an unresolvable wall time): the preview stays where it was.
    return undefined;
  }
}

/** The polite live-region text for a completed drop. */
export function dropAnnouncement(
  name: string,
  next: CalendarEvent,
  kind: DragKind,
  timeZone: string,
): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: typeof next.start === "string" ? "UTC" : timeZone,
  });
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  if (typeof next.start === "string") return `Moved ${name} to ${day.format(asDate(next.start))}`;
  const at = kind === "resize-end" ? asDate(next.end as Date) : next.start;
  const when = `${day.format(at)}, ${time.format(at)}`;
  return kind === "resize-end" ? `Resized ${name} to end ${when}` : `Moved ${name} to ${when}`;
}
