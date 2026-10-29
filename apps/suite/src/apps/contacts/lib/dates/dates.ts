// AUTHORED-BY Codex GPT-6.1-Sol
import type {
  ContactDate,
  ContactEventPlan,
  ContactOccasion,
  DateOptions,
  DatesContact,
  DateWindow,
  LeapDayPolicy,
  PlanOptions,
  UpcomingContactDate,
} from "./types";
import {
  ContactDatesError,
  fullDate,
  leapYear,
  nonblank,
  parseContactDate,
  record,
} from "./validation";

/** Input order, birthday before anniversary. Fresh objects, with no contact mutation. */
export function extractContactDates(contacts: readonly DatesContact[]): ContactOccasion[] {
  if (!Array.isArray(contacts)) throw new ContactDatesError("invalid-contact");
  const ids = new Set<string>();
  const result: ContactOccasion[] = [];
  for (const contact of contacts) {
    record(contact, ["id", "name", "birthday", "anniversary"], "invalid-contact");
    if (!nonblank(contact.id) || !nonblank(contact.name)) {
      throw new ContactDatesError("invalid-contact");
    }
    if (ids.has(contact.id)) throw new ContactDatesError("duplicate-contact");
    ids.add(contact.id);
    for (const kind of ["birthday", "anniversary"] as const) {
      if (Object.hasOwn(contact, kind)) {
        result.push({
          contactId: contact.id,
          contactName: contact.name,
          kind,
          sourceDate: parseContactDate(contact[kind]),
        });
      }
    }
  }
  return result;
}

function policy(options: DateOptions | PlanOptions, plan: boolean): LeapDayPolicy {
  record(options, plan ? ["leapDay", "startYear"] : ["leapDay"], "invalid-options");
  if (options.leapDay !== "feb28" && options.leapDay !== "mar1") {
    throw new ContactDatesError("invalid-options");
  }
  return options.leapDay;
}

function occurrence(date: ContactDate, year: number, leapDay: LeapDayPolicy): string {
  let { month, day } = date;
  if (month === 2 && day === 29 && !leapYear(year)) {
    month = leapDay === "feb28" ? 2 : 3;
    day = leapDay === "feb28" ? 28 : 1;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Plans only: callers review and persist using their calendar adapter. */
export function planContactEvents(
  contacts: readonly DatesContact[],
  options: PlanOptions,
): ContactEventPlan[] {
  const leapDay = policy(options, true);
  if (!Number.isInteger(options.startYear) || options.startYear < 1 || options.startYear > 9999) {
    throw new ContactDatesError("invalid-options");
  }
  return extractContactDates(contacts).map((occasion) => {
    const { sourceDate, contactName, kind } = occasion;
    return {
      ...occasion,
      title: `${contactName} — ${kind}`,
      allDay: true,
      startDate: occurrence(
        sourceDate,
        Math.max(options.startYear, sourceDate.year ?? options.startYear),
        leapDay,
      ),
      durationDays: 1,
      recurrence: {
        frequency: "YEARLY",
        interval: 1,
        month: sourceDate.month,
        day: sourceDate.day,
        leapDay,
      },
    };
  });
}

/** All occurrences in an inclusive window, ordered by date, contact ID, then kind. */
export function upcomingContactDates(
  contacts: readonly DatesContact[],
  window: DateWindow,
  options: DateOptions,
): UpcomingContactDate[] {
  const leapDay = policy(options, false);
  record(window, ["start", "end"], "invalid-window");
  const start = fullDate(window.start);
  const end = fullDate(window.end);
  if (window.start > window.end) throw new ContactDatesError("invalid-window");
  const result: UpcomingContactDate[] = [];
  for (const occasion of extractContactDates(contacts)) {
    const { sourceDate } = occasion;
    for (let year = Math.max(start.year, sourceDate.year ?? start.year); year <= end.year; year++) {
      const date = occurrence(sourceDate, year, leapDay);
      if (date >= window.start && date <= window.end) {
        result.push({
          ...occasion,
          sourceDate: { ...sourceDate },
          date,
          ...(sourceDate.year === undefined ? {} : { age: year - sourceDate.year }),
        });
      }
    }
  }
  return result.sort(
    (a, b) =>
      compare(a.date, b.date) || compare(a.contactId, b.contactId) || compare(a.kind, b.kind),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
