// AUTHORED-BY Codex GPT-6.1-Sol
import { dayOf, dueLocal, formatter, instant, requireInput } from "./calendar";
import { validateTask } from "./filters";
import type { ListTask } from "./types";

function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Missing dates last, local date ascending, all-day before timed on the same date. */
export function compareDue(timeZone: string): (a: ListTask, b: ListTask) => number {
  const format = formatter(timeZone);
  return (a, b) => {
    validateTask(a);
    validateTask(b);
    if (a.due === undefined) return b.due === undefined ? 0 : 1;
    if (b.due === undefined) return -1;
    const dayOrder = compare(dayOf(dueLocal(a.due, format)), dayOf(dueLocal(b.due, format)));
    if (dayOrder !== 0) return dayOrder;
    if (a.due.kind === "all-day") return b.due.kind === "all-day" ? 0 : -1;
    if (b.due.kind === "all-day") return 1;
    return compare(instant(a.due.at), instant(b.due.at));
  };
}

/** P1 first; absent priority is P4. Equal values compare equal for stable sorting. */
export function comparePriority(a: ListTask, b: ListTask): number {
  for (const task of [a, b]) {
    validateTask(task);
    requireInput(
      task.priority === undefined || [1, 2, 3, 4].includes(task.priority),
      "Priority must be P1–P4",
    );
  }
  return compare(a.priority ?? 4, b.priority ?? 4);
}

/** SH-L1 fractional base-62 keys, ordinary lexical order, absent keys last. */
export function compareManualOrder(a: ListTask, b: ListTask): number {
  for (const task of [a, b]) {
    validateTask(task);
    requireInput(
      task.orderKey === undefined ||
        (typeof task.orderKey === "string" &&
          /^[0-9A-Za-z]+$/.test(task.orderKey) &&
          !task.orderKey.endsWith("0")),
      "Invalid manual order key",
    );
  }
  if (a.orderKey === undefined) return b.orderKey === undefined ? 0 : 1;
  if (b.orderKey === undefined) return -1;
  return compare(a.orderKey, b.orderKey);
}
