// AUTHORED-BY Codex GPT-6.1-Sol

/** Plain projection supplied by a contact adapter, not an RDF/contact replacement. */
export interface DatesContact {
  readonly id: string;
  readonly name: string;
  /** Exactly YYYY-MM-DD or --MM-DD. Absence means unknown; null/blank are invalid. */
  readonly birthday?: string;
  readonly anniversary?: string;
}

export interface ContactDate {
  readonly year?: number;
  readonly month: number;
  readonly day: number;
}

export type LeapDayPolicy = "feb28" | "mar1";
export interface DateOptions {
  readonly leapDay: LeapDayPolicy;
}
export interface PlanOptions extends DateOptions {
  /** Earliest calendar year to plan, 1–9999; known source years also constrain the start. */
  readonly startYear: number;
}
export interface DateWindow {
  /** Inclusive date-only bounds, YYYY-MM-DD, in years 0001–9999. */
  readonly start: string;
  readonly end: string;
}

export interface ContactOccasion {
  readonly contactId: string;
  readonly contactName: string;
  readonly kind: "birthday" | "anniversary";
  readonly sourceDate: ContactDate;
}

export interface ContactEventPlan extends ContactOccasion {
  readonly title: string;
  readonly allDay: true;
  readonly startDate: string;
  readonly durationDays: 1;
  /** Semantic descriptor, NOT a plain RRULE: apply leapDay only in non-leap years. */
  readonly recurrence: {
    readonly frequency: "YEARLY";
    readonly interval: 1;
    readonly month: number;
    readonly day: number;
    readonly leapDay: LeapDayPolicy;
  };
}

export interface UpcomingContactDate extends ContactOccasion {
  readonly date: string;
  /** Completed years at this occurrence (also anniversary years); absent for --MM-DD. */
  readonly age?: number;
}
