// AUTHORED-BY Codex GPT-6.1-Sol
import { check } from "./errors";
import { type BusyInterval, interval } from "./expand";

/** Merge overlapping AND touching busy intervals. Inputs and outputs never alias. */
export function mergeBusyIntervals(intervals: readonly BusyInterval[]): BusyInterval[] {
  check(Array.isArray(intervals), "invalid-input");
  const sorted = Array.from(intervals, (item) => {
    interval(item);
    return { start: item.start, end: item.end };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const item of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && item.start <= previous.end) {
      previous.end = Math.max(previous.end, item.end);
    } else {
      merged.push(item);
    }
  }
  return merged;
}
