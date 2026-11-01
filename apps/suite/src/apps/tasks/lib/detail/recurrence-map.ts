// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type RecurrenceRule as EditorRule,
  validateRecurrence,
} from "@jeswr/suite-ui/date-time/model";
import { type RecurrenceRule, validateRule } from "../model/recurrence";

/** DS-08 supports more patterns than the Tasks wire model. Never truncate a pattern. */
export function fromEditorRule(rule: EditorRule | null, due: Date): RecurrenceRule | undefined {
  if (!rule) return undefined;
  validateRecurrence(rule);
  if (
    rule.bySetPos !== undefined ||
    (rule.byMonthDay && (rule.byMonthDay.length !== 1 || (rule.byMonthDay[0] as number) < 1)) ||
    (rule.byMonth && (rule.byMonth.length !== 1 || rule.byMonth[0] !== due.getMonth() + 1)) ||
    (rule.freq === "YEARLY" && rule.byMonthDay && rule.byMonthDay[0] !== due.getDate()) ||
    (rule.freq === "YEARLY" && rule.byMonthDay && !rule.byMonth)
  )
    throw new RangeError(
      "This repeat pattern isn't supported yet. Choose a day, week, month or year pattern.",
    );
  const result: RecurrenceRule = {
    frequency: rule.freq,
    interval: rule.interval,
    ...(rule.byDay ? { byDay: [...rule.byDay] } : {}),
    ...(rule.freq === "MONTHLY" && rule.byMonthDay ? { byMonthDay: rule.byMonthDay[0] } : {}),
    ...(rule.count !== undefined ? { count: rule.count } : {}),
    ...(rule.until ? { until: rule.until.length === 10 ? rule.until : new Date(rule.until) } : {}),
  };
  validateRule(result);
  return result;
}

export function toEditorRule(rule: RecurrenceRule | undefined): EditorRule | null {
  if (!rule) return null;
  validateRule(rule);
  return {
    freq: rule.frequency,
    interval: rule.interval ?? 1,
    ...(rule.byDay ? { byDay: [...new Set(rule.byDay)] } : {}),
    ...(rule.byMonthDay !== undefined ? { byMonthDay: [rule.byMonthDay] } : {}),
    ...(rule.count !== undefined ? { count: rule.count } : {}),
    ...(rule.until !== undefined
      ? {
          until:
            rule.until instanceof Date
              ? rule.until.toISOString().replace(".000Z", "Z")
              : rule.until,
        }
      : {}),
  };
}
