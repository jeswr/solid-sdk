// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  DAY,
  dayOf,
  dueLocal,
  instant,
  localTime,
  range,
  readContext,
  record,
  requireInput,
  resolveLocal,
  validateDue,
} from "./calendar";
import type { DueDate, ListContext, RepeatRule } from "./types";
import { TaskListError } from "./types";

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const RULE_KEYS = ["frequency", "interval", "from", "byDay", "byMonthDay", "count", "until"];

function supported(condition: unknown): asserts condition {
  if (!condition) throw new TaskListError("unsupported-rule", "Unsupported recurrence rule");
}

function validateRule(rule: RepeatRule): void {
  record(rule);
  supported(Object.keys(rule).every((key) => RULE_KEYS.includes(key)));
  supported(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.frequency));
  supported(
    rule.interval === undefined || (Number.isSafeInteger(rule.interval) && rule.interval > 0),
  );
  supported(rule.from === undefined || rule.from === "due" || rule.from === "completion");
  if (rule.byDay !== undefined) {
    supported(
      rule.frequency === "WEEKLY" &&
        Array.isArray(rule.byDay) &&
        rule.byDay.length > 0 &&
        new Set(rule.byDay).size === rule.byDay.length &&
        Array.from(rule.byDay).every((day) => WEEKDAYS.includes(day)),
    );
  }
  if (rule.byMonthDay !== undefined) {
    supported(
      rule.frequency === "MONTHLY" &&
        Number.isInteger(rule.byMonthDay) &&
        rule.byMonthDay >= 1 &&
        rule.byMonthDay <= 31,
    );
  }
  supported(rule.count === undefined || (Number.isSafeInteger(rule.count) && rule.count > 0));
  supported(rule.count === undefined || rule.until === undefined);
  if (rule.until !== undefined) validateDue(rule.until);
}

function weekday(local: number): number {
  return (new Date(local).getUTCDay() + 6) % 7;
}

function nextLocal(base: number, rule: RepeatRule): number {
  const interval = rule.interval ?? 1;
  if (rule.frequency === "DAILY") return range(base + interval * DAY);
  if (rule.frequency === "WEEKLY") {
    if (rule.byDay === undefined) return range(base + interval * 7 * DAY);
    const current = weekday(base);
    const days = rule.byDay.map((day) => WEEKDAYS.indexOf(day)).sort((a, b) => a - b);
    const later = days.find((day) => day > current);
    const delta =
      later === undefined ? interval * 7 - current + (days[0] as number) : later - current;
    return range(base + delta * DAY);
  }
  const date = new Date(base);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = rule.byMonthDay ?? date.getUTCDate();
  // Gregorian patterns repeat within 400 years. Impossible interval/date combinations
  // must fail closed rather than loop forever or silently fall outside the interval.
  const attempts = rule.frequency === "MONTHLY" ? 4800 : 400;
  for (let step = 1; step <= attempts; step += 1) {
    const targetYear =
      rule.frequency === "YEARLY"
        ? year + interval * step
        : year + Math.floor((month + interval * step) / 12);
    const targetMonth = rule.frequency === "YEARLY" ? month : (month + interval * step) % 12;
    if (targetYear > 9999)
      throw new TaskListError("date-out-of-range", "Next occurrence is after year 9999");
    const candidate = new Date(Date.UTC(targetYear, targetMonth, day)).getTime();
    if (new Date(candidate).getUTCDate() === day) return range(candidate + base - dayOf(base));
  }
  throw new TaskListError("unsupported-rule", "No valid calendar date in the recurrence cycle");
}

export interface RepeatContext extends ListContext {
  /** Number of persisted closed copies before this completion. Required with count. */
  readonly completedOccurrences?: number;
}

/** Advance exactly one occurrence, preserving wall time across time-zone transitions. */
export function nextOccurrence(
  due: DueDate | undefined,
  rule: RepeatRule,
  context: RepeatContext,
): DueDate | undefined {
  validateRule(rule);
  const { now, format } = readContext(context);
  if (due !== undefined) validateDue(due);
  const completed = context.completedOccurrences;
  requireInput(
    completed === undefined || (Number.isSafeInteger(completed) && completed >= 0),
    "Invalid completed occurrence count",
  );
  if (rule.count !== undefined) {
    requireInput(
      completed !== undefined,
      "A count-limited rule requires the completed occurrence count",
    );
    if (completed + 1 >= rule.count) return undefined;
  }
  const allDay = due?.kind === "all-day";
  if (rule.until !== undefined) supported(rule.until.kind === (allDay ? "all-day" : "timed"));
  const base =
    due === undefined || rule.from === "completion"
      ? localTime(now, format)
      : dueLocal(due, format);
  const local = nextLocal(allDay ? dayOf(range(base)) : range(base), rule);
  if (allDay) {
    if (rule.until !== undefined && local > dueLocal(rule.until, format)) return undefined;
    return { kind: "all-day", date: new Date(local).toISOString().slice(0, 10) };
  }
  const at = resolveLocal(
    local,
    format,
    rule.until?.kind === "timed" ? instant(rule.until.at) : undefined,
  );
  return at === undefined ? undefined : { kind: "timed", at: new Date(at).toISOString() };
}
