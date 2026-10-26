// AUTHORED-BY Codex GPT-6.1-Sol
/** English names map directly to the VOC-01 schema:Monday … schema:Sunday values. */
export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export interface RecurrenceRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byDay?: Weekday[];
  byMonthDay?: number[];
}

export type Due =
  | { kind: "date"; date: string }
  | { kind: "dateTime"; dateTime: string; timeZone: string };

export interface QuickAddContext {
  /** Required clock seam. The parser never reads the system clock. */
  now: Date;
  /** IANA time zone, e.g. Europe/London. Invalid zones throw RangeError. */
  tz: string;
  locale?: "en-GB" | "en-US";
  /** Keep the recognised due phrase in the title while still returning its span. */
  keepDateText?: boolean;
}

export interface QuickAddSpan {
  kind: "due" | "recurrence" | "priority" | "project" | "label";
  /** Half-open UTF-16 offsets into the unmodified input, suitable for string.slice. */
  start: number;
  end: number;
  text: string;
}

export interface QuickAddResult {
  title: string;
  due?: Due;
  recurrence?: RecurrenceRule;
  /** P4 is the default when no priority token is present. */
  priority: 1 | 2 | 3 | 4;
  /** Unresolved name; matching/creation belongs to the consuming app. */
  project?: string;
  labels: string[];
  spans: QuickAddSpan[];
}
