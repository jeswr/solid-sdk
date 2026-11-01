// AUTHORED-BY Codex GPT-6.1-Sol
import { humanise, type RecurrenceRule } from "../model/recurrence";
import type { Reminder } from "../model/reminders";
import { parseQuickAdd as parseTokens } from "../quickadd";
import { localCalendar, toInstant } from "../quickadd/time";

export type ChipKind = "due" | "repeat" | "project" | "section" | "label" | "priority" | "reminder";
export interface Chip {
  kind: ChipKind;
  label: string;
  /** Half-open UTF-16 offsets into the original input; defaults have an empty span. */
  span: { start: number; end: number };
  invalid?: boolean;
}
export interface ComposeDue {
  date: Date;
  allDay?: string;
}
export interface ComposeContext {
  now: Date;
  tz: string;
  locale?: "en-GB" | "en-US";
  projects: { url: string; title: string }[];
  labels: string[];
  defaults?: { projectUrl?: string; sectionId?: string; sectionName?: string; due?: ComposeDue };
  keepText?: Set<ChipKind>;
}
export interface ComposeResult {
  title: string;
  due?: ComposeDue;
  recurrence?: RecurrenceRule;
  priority: 1 | 2 | 3 | 4;
  project?: { kind: "existing"; url: string } | { kind: "create"; name: string };
  sectionId?: string;
  labels: { name: string; existing: boolean }[];
  reminders: Reminder[];
  chips: Chip[];
  canSubmit: boolean;
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(
        Math.min(
          (next[j] as number) + 1,
          (row[j + 1] as number) + 1,
          (row[j] as number) + (a[i] === b[j] ? 0 : 1),
        ),
      );
    row = next;
  }
  return row[b.length] as number;
}

/** Stable input order breaks ties within each matching tier. */
function matchName(name: string, names: string[]): string | undefined {
  const query = name.toLowerCase();
  return (
    names.find((name) => name.toLowerCase() === query) ??
    names.find((name) => name.toLowerCase().startsWith(query)) ??
    names.find((name) => {
      const value = name.toLowerCase();
      let index = 0;
      for (const char of value) if (char === query[index]) index++;
      return index === query.length || distance(query, value) <= 2;
    })
  );
}

function formatDue(due: ComposeDue, ctx: ComposeContext): string {
  const date = localCalendar(due.date, ctx.tz);
  const today = localCalendar(ctx.now, ctx.tz);
  const days =
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
    86400000;
  const label =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-GB", {
            timeZone: "UTC",
            ...(days > 1 && days <= 6
              ? ({ weekday: "short" } as const)
              : ({
                  day: "numeric",
                  month: "short",
                  ...(date.getUTCFullYear() === today.getUTCFullYear()
                    ? {}
                    : ({ year: "numeric" } as const)),
                } as const)),
          }).format(date);
  return due.allDay ? label : `${label} ${date.toISOString().slice(11, 16)}`;
}

function dueValue(due: NonNullable<ReturnType<typeof parseTokens>["due"]>, tz: string): ComposeDue {
  if (due.kind === "dateTime") return { date: new Date(due.dateTime) };
  // Midnight exists for the supported London calendar, even on DST transition days.
  const date = toInstant(new Date(`${due.date}T00:00:00Z`), tz);
  if (!date) throw new RangeError("Nonexistent all-day midnight");
  return { date, allDay: due.date };
}

/** Pure adapter: scheduling values use the model's shape; token offsets always refer to text. */
export function parseQuickAdd(text: string, ctx: ComposeContext): ComposeResult {
  let working = text;
  const chips: Chip[] = [];
  const reminders: Reminder[] = [];
  const keep = (kind: ChipKind) => ctx.keepText?.has(kind) === true;
  const mask = (start: number, end: number) => {
    working = working.slice(0, start) + "\u0000".repeat(end - start) + working.slice(end);
  };
  for (const marker of text.matchAll(/(?<!\S)!\s*/g)) {
    const start = marker.index;
    const rest = working.slice(start + marker[0].length);
    const offset = /^(\d+)\s*(h(?:ours?)?|m(?:inutes?)?|d(?:ays?)?)\s+before\b/i.exec(rest);
    let length: number;
    let reminder: Reminder;
    let when: string;
    if (offset) {
      length = offset[0].length;
      const unit = (offset[2] as string)[0]?.toLowerCase();
      const n = Number(offset[1]);
      reminder = { offset: unit === "d" ? `-P${n}D` : `-PT${n}${unit === "h" ? "H" : "M"}` };
      when = `${n} ${unit === "d" ? "day" : unit === "h" ? "hour" : "minute"}${n === 1 ? "" : "s"} before`;
    } else {
      const time = /^(?:\d{1,2}(?::\d{2})?\s*[ap]m|\d{1,2}:\d{2}|noon|midnight)\b/i.exec(rest);
      const parsed = parseTokens(time ? time[0] : rest, ctx);
      const span = parsed.spans.find((span) => span.kind === "due" && span.start === 0);
      if (!span || !parsed.due) continue;
      length = span.end;
      const due = dueValue(parsed.due, ctx.tz);
      reminder = { time: due.date };
      when = formatDue(due, ctx);
    }
    const end = start + marker[0].length + length;
    mask(start, end);
    if (!keep("reminder")) {
      reminders.push(reminder);
      chips.push({ kind: "reminder", label: `Remind ${when}`, span: { start, end } });
    }
  }
  const parsed = parseTokens(working, ctx);
  const result: ComposeResult = {
    title: "",
    priority: keep("priority") ? 4 : parsed.priority,
    labels: [],
    reminders,
    chips,
    canSubmit: false,
  };
  const due = keep("due")
    ? undefined
    : parsed.due && !(keep("repeat") && !parsed.spans.some((span) => span.kind === "due"))
      ? dueValue(parsed.due, ctx.tz)
      : ctx.defaults?.due;
  if (due) result.due = due;
  const anchor = localCalendar(due?.date ?? ctx.now, ctx.tz);
  if (parsed.recurrence && !keep("repeat")) {
    result.recurrence = {
      frequency: parsed.recurrence.freq,
      interval: parsed.recurrence.interval,
      ...(parsed.recurrence.byDay ? { byDay: parsed.recurrence.byDay } : {}),
      ...(parsed.recurrence.byMonthDay ? { byMonthDay: parsed.recurrence.byMonthDay[0] } : {}),
    };
  }
  for (const span of parsed.spans) {
    const kind = span.kind === "recurrence" ? "repeat" : span.kind;
    if (keep(kind)) continue;
    let label: string;
    if (kind === "project") {
      const name = matchName(
        parsed.project as string,
        ctx.projects.map((project) => project.title),
      );
      const project = ctx.projects.find((project) => project.title === name);
      result.project = project
        ? { kind: "existing", url: project.url }
        : { kind: "create", name: parsed.project as string };
      label = project ? `#${project.title}` : `Create project '${parsed.project}'`;
    } else if (kind === "label") {
      const raw = text.slice(span.start + 1, span.end);
      const name = matchName(raw, ctx.labels);
      const resolved = { name: name ?? raw, existing: name !== undefined };
      if (!result.labels.some((label) => label.name.toLowerCase() === resolved.name.toLowerCase()))
        result.labels.push(resolved);
      label = `@${resolved.name}`;
    } else if (kind === "due") label = `Due ${formatDue(due as ComposeDue, ctx)}`;
    else if (kind === "repeat")
      label = `Repeats ${humanise(result.recurrence as RecurrenceRule, anchor)}`;
    else label = `P${result.priority}`;
    chips.push({ kind, label, span: { start: span.start, end: span.end } });
  }
  if (!result.project && ctx.defaults?.projectUrl && !keep("project"))
    result.project = { kind: "existing", url: ctx.defaults.projectUrl };
  if (ctx.defaults?.sectionId && !keep("section")) {
    result.sectionId = ctx.defaults.sectionId;
    chips.push({
      kind: "section",
      label: ctx.defaults.sectionName ?? "Section",
      span: { start: 0, end: 0 },
    });
  }
  if (due && !chips.some((chip) => chip.kind === "due"))
    chips.push({ kind: "due", label: `Due ${formatDue(due, ctx)}`, span: { start: 0, end: 0 } });
  if (!due) {
    result.reminders = [];
    for (const chip of chips) if (chip.kind === "reminder") chip.invalid = true;
  }
  chips.sort((a, b) => a.span.start - b.span.start);
  let cursor = 0;
  const title: string[] = [];
  for (const chip of chips) {
    if (chip.span.start === chip.span.end) continue;
    title.push(text.slice(cursor, chip.span.start));
    cursor = chip.span.end;
  }
  title.push(text.slice(cursor));
  result.title = title.join(" ").trim().replace(/\s+/g, " ");
  result.canSubmit = result.title.length > 0;
  return result;
}

/**
 * Removing a chip restores its literal token by disabling that kind of interpretation.
 * Text remains unchanged (so spans stay valid). Pass the returned keepText into the next
 * parse; it suppresses all tokens of that kind until explicitly cleared by the composer.
 */
export function removeChip(
  text: string,
  chip: Chip,
  keepText = new Set<ChipKind>(),
): { text: string; keepText: Set<ChipKind> } {
  return { text, keepText: new Set([...keepText, chip.kind]) };
}
