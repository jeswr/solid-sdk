// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  escapeText,
  foldLine,
  type Property,
  parameters,
  parseProperty,
  requireValue,
  unescapeText,
  unfoldLines,
} from "./content-lines";
import { dateLine, formatUtc, parseDate, parseUtc } from "./dates";
import type { VTodoCalendar, VTodoTask } from "./types";
import { integer, modelPriority, nonblank, stateFor, validateTask } from "./validation";

function required(
  properties: ReadonlyMap<string, Property>,
  name: string,
  allowed: Readonly<Record<string, string>> = {},
): string {
  const property = properties.get(name);
  requireValue(property, "missing-required");
  parameters(property, allowed);
  return property.value;
}

function readTask(properties: ReadonlyMap<string, Property>): VTodoTask {
  type Draft = { -readonly [K in keyof VTodoTask]: VTodoTask[K] };
  const task: Draft = {
    uid: unescapeText(required(properties, "UID", { VALUE: "TEXT" })),
    stamp: parseUtc(required(properties, "DTSTAMP", { VALUE: "DATE-TIME" })),
    title: unescapeText(required(properties, "SUMMARY", { VALUE: "TEXT" })),
    state: "open",
  };
  for (const property of properties.values()) {
    const { name, value } = property;
    switch (name) {
      case "UID":
      case "SUMMARY":
        parameters(property, { VALUE: "TEXT" });
        break;
      case "DTSTAMP":
        parameters(property, { VALUE: "DATE-TIME" });
        break;
      case "DESCRIPTION":
        parameters(property, { VALUE: "TEXT" });
        task.description = unescapeText(value);
        break;
      case "DUE":
      case "DTSTART": {
        const allDay = property.params.get("VALUE") === "DATE";
        parameters(property, { VALUE: allDay ? "DATE" : "DATE-TIME" });
        const date = parseDate(value, allDay);
        if (name === "DUE") task.due = date;
        else task.start = date;
        break;
      }
      case "COMPLETED":
        parameters(property, { VALUE: "DATE-TIME" });
        task.endedAt = parseUtc(value);
        break;
      case "STATUS":
        parameters(property, { VALUE: "TEXT" });
        task.status = value.toUpperCase() as VTodoTask["status"] & string;
        break;
      case "PRIORITY":
      case "PERCENT-COMPLETE": {
        parameters(property, { VALUE: "INTEGER" });
        requireValue(/^\+?\d+$/u.test(value), "invalid-value");
        const number = Number(value);
        integer(number, name === "PRIORITY" ? 9 : 100);
        if (name === "PRIORITY") {
          task.icalPriority = number;
          const priority = modelPriority(number);
          if (priority !== undefined) task.priority = priority;
        } else task.percentComplete = number;
        break;
      }
      case "RRULE":
        parameters(property, { VALUE: "RECUR" });
        task.rrule = value;
        break;
      case "RELATED-TO":
        parameters(property, { VALUE: "TEXT", RELTYPE: "PARENT" });
        task.parentUid = unescapeText(value);
        break;
      default:
        requireValue(false, "unsupported-property");
    }
  }
  task.state = stateFor(task.status, task.endedAt);
  validateTask(task);
  return task;
}

/** Parse a complete supported VCALENDAR atomically; no partial success or skipped data. */
export function parseVTodo(input: string): VTodoCalendar {
  const lines = unfoldLines(input);
  requireValue(lines.shift()?.toUpperCase() === "BEGIN:VCALENDAR", "invalid-syntax");
  const headers = new Map<string, Property>();
  const tasks: VTodoTask[] = [];
  let current: Map<string, Property> | undefined;
  let closed = false;
  for (const line of lines) {
    requireValue(!closed, "invalid-syntax");
    const property = parseProperty(line);
    const { name, value } = property;
    if (name === "BEGIN") {
      parameters(property, {});
      requireValue(value.toUpperCase() === "VTODO", "unsupported-component");
      requireValue(!current, "invalid-syntax");
      current = new Map();
    } else if (name === "END") {
      parameters(property, {});
      if (current) {
        requireValue(value.toUpperCase() === "VTODO", "invalid-syntax");
        tasks.push(readTask(current));
        current = undefined;
      } else {
        requireValue(value.toUpperCase() === "VCALENDAR", "invalid-syntax");
        closed = true;
      }
    } else {
      if (!current) {
        requireValue(tasks.length === 0, "invalid-syntax");
        requireValue(["VERSION", "PRODID", "CALSCALE"].includes(name), "unsupported-property");
        parameters(property, {});
      }
      const target = current ?? headers;
      requireValue(!target.has(name), "duplicate");
      target.set(name, property);
    }
  }
  requireValue(closed && !current, "invalid-syntax");
  requireValue(required(headers, "VERSION") === "2.0", "invalid-value");
  const calendar: VTodoCalendar = {
    productId: unescapeText(required(headers, "PRODID")),
    tasks,
    ...(headers.has("CALSCALE")
      ? { scale: required(headers, "CALSCALE").toUpperCase() as "GREGORIAN" }
      : {}),
  };
  validateCalendar(calendar);
  return calendar;
}

function validateCalendar(calendar: VTodoCalendar): void {
  requireValue(calendar && typeof calendar === "object", "invalid-input");
  requireValue(
    Object.keys(calendar).every((key) => ["productId", "scale", "tasks"].includes(key)),
    "unsupported-property",
  );
  nonblank(calendar.productId);
  if (calendar.scale !== undefined) requireValue(calendar.scale === "GREGORIAN", "invalid-value");
  requireValue(Array.isArray(calendar.tasks) && calendar.tasks.length > 0, "missing-required");
  const ids = new Set<string>();
  for (const task of calendar.tasks) {
    validateTask(task);
    requireValue(!ids.has(task.uid), "duplicate");
    ids.add(task.uid);
  }
}

function taskLines(task: VTodoTask): string[] {
  const lines = [
    "BEGIN:VTODO",
    `UID:${escapeText(task.uid)}`,
    `DTSTAMP:${formatUtc(task.stamp)}`,
    `SUMMARY:${escapeText(task.title)}`,
  ];
  if (task.description !== undefined) lines.push(`DESCRIPTION:${escapeText(task.description)}`);
  if (task.due !== undefined) lines.push(dateLine("DUE", task.due));
  if (task.start !== undefined) lines.push(dateLine("DTSTART", task.start));
  if (task.endedAt !== undefined) lines.push(`COMPLETED:${formatUtc(task.endedAt)}`);
  if (task.status !== undefined) lines.push(`STATUS:${task.status}`);
  else if (task.state === "closed" && task.endedAt === undefined) lines.push("STATUS:COMPLETED");
  const priority =
    task.icalPriority ??
    ({ high: 1, medium: 5, low: 9 } as const)[task.priority as "high" | "medium" | "low"];
  if (priority !== undefined) lines.push(`PRIORITY:${priority}`);
  if (task.percentComplete !== undefined) lines.push(`PERCENT-COMPLETE:${task.percentComplete}`);
  if (task.rrule !== undefined) lines.push(`RRULE:${task.rrule}`);
  if (task.parentUid !== undefined)
    lines.push(`RELATED-TO;RELTYPE=PARENT:${escapeText(task.parentUid)}`);
  return [...lines, "END:VTODO"];
}

/** Deterministic CRLF output with mandatory envelope fields and UTF-8 folding. */
export function serializeVTodo(calendar: VTodoCalendar): string {
  validateCalendar(calendar);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${escapeText(calendar.productId)}`];
  if (calendar.scale !== undefined) lines.push(`CALSCALE:${calendar.scale}`);
  lines.push(...calendar.tasks.flatMap(taskLines), "END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
