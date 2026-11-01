// AUTHORED-BY Codex GPT-6.1-Sol
/** Date-only strings are civil dates; Date instances are instants. End dates are exclusive. */
export type CalendarDate = Date | string;
export const WEEKDAYS = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
} as const;
export type Weekday = keyof typeof WEEKDAYS;
export interface RecurrenceRule {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number | undefined;
  count?: number | undefined;
  until?: CalendarDate | undefined;
  byDay?: Weekday[] | undefined;
  byMonthDay?: number[] | undefined;
  byMonth?: number[] | undefined;
  exceptDate?: CalendarDate[] | undefined;
}
export interface Reminder {
  triggerOffset?: string | undefined;
  triggerTime?: Date | undefined;
}
export interface CalendarEvent {
  name: string;
  start: CalendarDate;
  end?: CalendarDate | undefined;
  location?: string | undefined;
  description?: string | undefined;
  inCalendar?: string | undefined;
  uid?: string | undefined;
  recurrence?: RecurrenceRule | undefined;
  reminders?: Reminder[] | undefined;
}
export interface Calendar {
  title: string;
  color?: string | undefined;
}
export interface StoredItem<T> {
  url: string;
  etag: string | null;
  data: T;
}
