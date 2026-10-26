// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { requireValue, textValue } from "./content-lines";
import { dateValue, utcValue } from "./dates";
import type { VTodoTask } from "./types";

export function nonblank(value: unknown): asserts value is string {
  textValue(value);
  requireValue(value.trim().length > 0, "missing-required");
}

export function integer(value: unknown, max: number): asserts value is number {
  requireValue(
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max,
    "invalid-value",
  );
}

export function modelPriority(value: number): VTodoTask["priority"] {
  if (value === 0) return undefined;
  if (value <= 4) return "high";
  return value === 5 ? "medium" : "low";
}

export function stateFor(
  status: VTodoTask["status"],
  endedAt: VTodoTask["endedAt"],
): VTodoTask["state"] {
  return status === "COMPLETED" || status === "CANCELLED" || endedAt !== undefined
    ? "closed"
    : "open";
}

export function validateTask(task: VTodoTask): void {
  requireValue(task && typeof task === "object", "invalid-input");
  const keys = [
    "uid",
    "stamp",
    "title",
    "state",
    "description",
    "due",
    "start",
    "endedAt",
    "status",
    "priority",
    "icalPriority",
    "percentComplete",
    "rrule",
    "parentUid",
  ];
  requireValue(
    Object.keys(task).every((key) => keys.includes(key)),
    "unsupported-property",
  );
  nonblank(task.uid);
  requireValue(!task.uid.includes("\n"), "invalid-value");
  nonblank(task.title);
  utcValue(task.stamp);
  requireValue(task.state === "open" || task.state === "closed", "invalid-value");
  if (task.description !== undefined) textValue(task.description);
  if (task.status !== undefined) {
    requireValue(
      ["NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"].includes(task.status),
      "invalid-value",
    );
    requireValue(task.state === stateFor(task.status, undefined), "invalid-value");
  }
  if (task.endedAt !== undefined) {
    utcValue(task.endedAt);
    requireValue(task.state === "closed" && task.status !== "CANCELLED", "invalid-value");
  }
  if (task.priority !== undefined)
    requireValue(["high", "medium", "low"].includes(task.priority), "invalid-value");
  if (task.icalPriority !== undefined) {
    integer(task.icalPriority, 9);
    requireValue(task.priority === modelPriority(task.icalPriority), "invalid-value");
  }
  if (task.percentComplete !== undefined) integer(task.percentComplete, 100);
  if (task.due !== undefined) dateValue(task.due);
  if (task.start !== undefined) dateValue(task.start);
  if (task.due !== undefined && task.start !== undefined) {
    requireValue(task.due.kind === task.start.kind, "invalid-value");
    requireValue(task.due.value > task.start.value, "invalid-value");
  }
  if (task.parentUid !== undefined) {
    nonblank(task.parentUid);
    requireValue(!task.parentUid.includes("\n") && task.parentUid !== task.uid, "invalid-value");
  }
  if (task.rrule !== undefined) {
    // Only lexical framing is checked: recurrence semantics belong to the recurrence layer.
    requireValue(
      typeof task.rrule === "string" &&
        /^[A-Za-z0-9-]+=[A-Za-z0-9,+-]+(?:;[A-Za-z0-9-]+=[A-Za-z0-9,+-]+)*$/u.test(task.rrule),
      "invalid-value",
    );
    requireValue(task.start !== undefined, "missing-required");
  }
}
