// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  check,
  checkEpoch,
  type DragInput,
  type DragResult,
  MAX_DAY_DELTA,
  MAX_DELTA_MINUTES,
  SNAP_MINUTES,
} from "./types";
import { DAY_MS, MINUTE_MS, Zone } from "./zone";

/** Shared by pointer gestures and keyboard/dialog edits. Does not mutate input. */
export function applyDrag(input: DragInput): DragResult {
  check(input !== null && typeof input === "object", "INVALID_INPUT");
  const { start, end, deltaMinutes, snapMinutes, kind, overlap } = input;
  const dayDelta = input.dayDelta === undefined ? 0 : input.dayDelta;
  const allDay = input.allDay === undefined ? false : input.allDay;
  const scope = input.scope === undefined ? "this" : input.scope;

  // All size checks precede Intl construction or conversion work.
  check(Number.isFinite(deltaMinutes) && Number.isFinite(dayDelta), "INVALID_DELTA");
  check(
    Math.abs(deltaMinutes) <= MAX_DELTA_MINUTES && Math.abs(dayDelta) <= MAX_DAY_DELTA,
    "DELTA_TOO_LARGE",
  );
  const rawDeltaMs = deltaMinutes * MINUTE_MS;
  const deltaMs = Math.round(rawDeltaMs);
  // Allow only rounding from number representation and multiplication, not submillisecond deltas.
  check(
    Number.isSafeInteger(deltaMs) &&
      Math.abs(rawDeltaMs - deltaMs) <= 2 * Number.EPSILON * Math.abs(rawDeltaMs) &&
      Number.isInteger(dayDelta),
    "INVALID_DELTA",
  );
  check(
    SNAP_MINUTES.some((step) => step === snapMinutes),
    "INVALID_SNAP",
  );
  checkEpoch(start);
  checkEpoch(end);
  check(end > start, "INVALID_RANGE");
  check(kind === "move" || kind === "resize-start" || kind === "resize-end", "INVALID_GESTURE");
  check(scope === "this" || scope === "following" || scope === "all", "INVALID_SCOPE");
  check(overlap === undefined || overlap === "earlier" || overlap === "later", "INVALID_OVERLAP");
  check(typeof allDay === "boolean", "INVALID_ALL_DAY");
  if (allDay) {
    check(deltaMinutes % 1440 === 0, "INVALID_ALL_DAY");
    check(kind !== "resize-start", "INVALID_GESTURE");
  }

  const zone = new Zone(input.timeZone);
  const startWall = zone.wall(start);
  const endWall = zone.wall(end);
  checkEpoch(startWall);
  checkEpoch(endWall);
  const startOffset = startWall - start;
  const endOffset = endWall - end;
  const delta = deltaMs + dayDelta * DAY_MS;
  let nextStart = start;
  let nextEnd = end;
  let clamped = false;
  let dstAdjusted: boolean;

  if (allDay) {
    const startDay = Math.floor(startWall / DAY_MS) * DAY_MS;
    const endDay = Math.floor(endWall / DAY_MS) * DAY_MS;
    // Date boundaries use the first instant, including midnight gaps and overlaps.
    check(
      zone.resolve(startDay, startOffset, "earlier").instant === start &&
        zone.resolve(endDay, endOffset, "earlier").instant === end &&
        endDay > startDay,
      "INVALID_ALL_DAY",
    );
    if (kind === "move") {
      const moved = zone.resolve(startDay + delta, startOffset, "earlier");
      nextStart = moved.instant;
      const movedDay = Math.floor(zone.wall(nextStart) / DAY_MS) * DAY_MS;
      const movedEnd = zone.resolve(movedDay + endDay - startDay, endOffset, "earlier");
      nextEnd = movedEnd.instant;
      // A skipped end date can make the original calendar span impossible.
      check(
        Math.floor(zone.wall(nextEnd) / DAY_MS) * DAY_MS - movedDay === endDay - startDay,
        "INVALID_RANGE",
      );
      dstAdjusted = moved.dstAdjusted || movedEnd.dstAdjusted;
    } else {
      const proposed = endDay + delta;
      clamped = proposed < startDay + DAY_MS;
      const resized = zone.resolve(Math.max(proposed, startDay + DAY_MS), endOffset, "earlier");
      nextEnd = resized.instant;
      dstAdjusted = resized.dstAdjusted;
    }
  } else {
    const step = snapMinutes * MINUTE_MS;
    const isStart = kind !== "resize-end";
    const originalWall = isStart ? startWall : endWall;
    const offset = isStart ? startOffset : endOffset;
    const snapped = Math.floor((originalWall + delta + step / 2) / step) * step;
    let moving = zone.resolve(snapped, offset, overlap);
    if (kind === "move") {
      nextStart = moving.instant;
      nextEnd = nextStart + (end - start);
    } else {
      const limit = isStart ? end - step : start + step;
      clamped = isStart ? moving.instant > limit : moving.instant < limit;
      if (clamped) {
        const wallLimit = zone.wall(limit) / step;
        const boundary = (isStart ? Math.floor(wallLimit) : Math.ceil(wallLimit)) * step;
        moving = zone.resolve(boundary, offset, isStart ? "earlier" : "later");
      }
      if (isStart) nextStart = moving.instant;
      else nextEnd = moving.instant;
      check(nextEnd - nextStart >= step, "INVALID_RANGE");
    }
    dstAdjusted = moving.dstAdjusted;
  }

  checkEpoch(nextStart);
  checkEpoch(nextEnd);
  check(nextEnd > nextStart, "INVALID_RANGE");
  const nextStartWall = zone.wall(nextStart);
  const nextEndWall = zone.wall(nextEnd);
  checkEpoch(nextStartWall);
  checkEpoch(nextEndWall);
  return {
    start: nextStart,
    end: nextEnd,
    clamped,
    dstAdjusted,
    scope,
    seriesOffset: {
      startMs: nextStart - start,
      endMs: nextEnd - end,
      startWallMinutes: (nextStartWall - startWall) / MINUTE_MS,
      endWallMinutes: (nextEndWall - endWall) / MINUTE_MS,
      startDayDelta: Math.floor(nextStartWall / DAY_MS) - Math.floor(startWall / DAY_MS),
      endDayDelta: Math.floor(nextEndWall / DAY_MS) - Math.floor(endWall / DAY_MS),
    },
  };
}
