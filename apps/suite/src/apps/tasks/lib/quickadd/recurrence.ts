// AUTHORED-BY Codex GPT-6.1-Sol
import type { RecurrenceRule, Weekday } from "./types";

const weekdays: Weekday[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const dayPattern =
  "(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
// Include unsupported nth-weekday phrases as a whole so they cannot become a partial rule/date.
export const recurrencePattern = new RegExp(
  `\\b(?:daily|weekly|monthly|yearly|every\\s+(?:\\d+(?:st|nd|rd|th)(?:\\s+${dayPattern})?|(?:\\d+\\s+)?(?:days?|weeks?|months?|years?)|weekday|${dayPattern}))(?![\\p{L}\\p{N}_])`,
  "giu",
);

export function parseRecurrence(phrase: string): RecurrenceRule | undefined {
  const value = phrase.toLowerCase().replace(/\s+/g, " ");
  if (value === "every weekday") {
    return { freq: "WEEKLY", interval: 1, byDay: weekdays.slice(1, 6) };
  }
  const weekday = weekdays.find((day) => {
    const name = value.replace(/^every /, "");
    return name === day.toLowerCase() || name === day.slice(0, 3).toLowerCase();
  });
  if (weekday) return { freq: "WEEKLY", interval: 1, byDay: [weekday] };
  const ordinal = /^every (\d+)(st|nd|rd|th)$/.exec(value);
  if (ordinal) {
    const day = Number(ordinal[1]);
    const suffix =
      day % 100 >= 11 && day % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
    if (day < 1 || day > 31 || ordinal[2] !== suffix) return undefined;
    return { freq: "MONTHLY", interval: 1, byMonthDay: [day] };
  }
  const unit = /^(?:every (?:(\d+) )?(day|week|month|year)s?|(daily|weekly|monthly|yearly))$/.exec(
    value,
  );
  if (!unit) return undefined;
  const interval = Number(unit[1] ?? 1);
  if (!Number.isSafeInteger(interval) || interval < 1) return undefined;
  const name = unit[2] ?? unit[3];
  const freq =
    name === "day" || name === "daily"
      ? "DAILY"
      : name === "week" || name === "weekly"
        ? "WEEKLY"
        : name === "month" || name === "monthly"
          ? "MONTHLY"
          : "YEARLY";
  return { freq, interval };
}

/** Only the initial due date; future expansion belongs to the recurrence library (TSK-02). */
export function recurrenceStart(rule: RecurrenceRule, today: Date): Date {
  const result = new Date(today);
  result.setUTCHours(0, 0, 0, 0);
  while (
    (rule.byDay && !rule.byDay.includes(weekdays[result.getUTCDay()] as Weekday)) ||
    (rule.byMonthDay && !rule.byMonthDay.includes(result.getUTCDate()))
  ) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}
