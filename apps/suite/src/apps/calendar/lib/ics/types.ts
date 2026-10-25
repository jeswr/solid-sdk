// AUTHORED-BY Codex GPT-6.1-Sol
/** ISO calendar date or second-precision date-time, with Z for UTC. No host-local conversion. */
export interface CalendarDate {
  value: string;
  tzid?: string;
}

/** Shared sched:RecurrenceRule fields, with RFC BY* selectors retained as plain arrays. */
export interface RecurrenceRule {
  frequency: string;
  interval?: number;
  count?: number;
  until?: string;
  byDay?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
  bySecond?: number[];
  byMinute?: number[];
  byHour?: number[];
  byYearDay?: number[];
  byWeekNo?: number[];
  bySetPos?: number[];
  weekStart?: string;
  exceptDate?: CalendarDate[];
}

/** sched:Reminder fields plus the VALARM delivery payload. Exactly one trigger is required. */
export interface Reminder {
  action: "DISPLAY" | "AUDIO" | "EMAIL";
  triggerOffset?: string;
  triggerTime?: string;
  related?: "START" | "END";
  description?: string;
  summary?: string;
  attendees?: string[];
  attachment?: string;
  repeat?: number;
  duration?: string;
}

/** CAL-00 boundary fields; DATE DTEND remains exclusive, as in RFC 5545. */
export interface CalendarEvent {
  uid: string;
  dtstamp: string;
  name: string;
  start: string;
  end?: string;
  tzid?: string;
  endTzid?: string;
  location?: string;
  description?: string;
  recurrence?: RecurrenceRule;
  /** EXDATE may occur without an RRULE. */
  exceptDate?: CalendarDate[];
  rdate?: CalendarDate[];
  reminders?: Reminder[];
}

export interface ICalendar {
  events: CalendarEvent[];
  /** Opaque VTIMEZONE definitions, retained without evaluation or network access. */
  timezones?: string[];
}
