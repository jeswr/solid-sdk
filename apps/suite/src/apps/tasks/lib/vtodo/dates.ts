// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { requireValue } from "./content-lines";
import type { VTodoDate } from "./types";

export function utcValue(value: unknown): asserts value is Date {
  requireValue(
    value instanceof Date &&
      Number.isFinite(value.getTime()) &&
      value.getUTCMilliseconds() === 0 &&
      value.getUTCFullYear() >= 1 &&
      value.getUTCFullYear() <= 9999,
    "invalid-value",
  );
}

export function formatUtc(value: Date): string {
  utcValue(value);
  return value.toISOString().replace(/[-:]/g, "").replace(".000", "");
}

export function parseUtc(value: string): Date {
  requireValue(/^\d{8}T\d{6}Z$/u.test(value), "invalid-value");
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  const result = new Date(iso);
  requireValue(formatUtc(result) === value, "invalid-value");
  return result;
}

export function dayValue(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value), "invalid-value");
  const date = new Date(`${value}T00:00:00Z`);
  utcValue(date);
  requireValue(date.toISOString().slice(0, 10) === value, "invalid-value");
}

export function dateValue(value: VTodoDate): void {
  requireValue(value && typeof value === "object", "invalid-value");
  requireValue(
    Object.keys(value).every((key) => key === "kind" || key === "value"),
    "invalid-value",
  );
  if (value.kind === "date") dayValue(value.value);
  else {
    requireValue(value.kind === "utc", "invalid-value");
    utcValue(value.value);
  }
}

export function dateLine(name: string, value: VTodoDate): string {
  dateValue(value);
  return value.kind === "date"
    ? `${name};VALUE=DATE:${value.value.replace(/-/g, "")}`
    : `${name}:${formatUtc(value.value)}`;
}

export function parseDate(value: string, allDay: boolean): VTodoDate {
  if (!allDay) return { kind: "utc", value: parseUtc(value) };
  requireValue(/^\d{8}$/u.test(value), "invalid-value");
  const result = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  dayValue(result);
  return { kind: "date", value: result };
}
