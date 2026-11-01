// AUTHORED-BY Codex GPT-6.1-Sol
export interface EventQuickAddContext {
  /** Required injected clock; never reads the system clock. */
  readonly now: Date;
  /** IANA zone, including UTC. */
  readonly tz: string;
}

export interface EventDraft {
  readonly title: string;
  /** ISO date for all-day drafts; UTC ISO instant for timed drafts. */
  readonly start: string;
  /** Exclusive; absent when neither a duration nor an end was supplied. */
  readonly end?: string;
  readonly durationMinutes?: number;
  readonly allDay: boolean;
  readonly timeZone: string;
  readonly location?: string;
  /** RFC 5545 RRULE value, without the RRULE: prefix. */
  readonly rrule?: string;
}

export type EventQuickAddErrorCode =
  | "invalid-input"
  | "invalid-context"
  | "unsupported-phrase"
  | "conflicting-fields"
  | "missing-date"
  | "missing-title"
  | "invalid-date"
  | "invalid-time"
  | "invalid-duration"
  | "nonexistent-time"
  | "ambiguous-time";

export interface QuickAddIssue {
  readonly code: EventQuickAddErrorCode;
  /** Half-open UTF-16 offsets into the original input. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** No partially scheduled draft is returned. Messages do not echo caller data. */
export class EventQuickAddError extends Error {
  constructor(
    public readonly code: EventQuickAddErrorCode,
    /** Original phrase, whitespace-normalised; no ambiguous text is consumed. */
    public readonly title: string,
    public readonly issues: readonly QuickAddIssue[],
  ) {
    super(`Calendar quick add: ${code}`);
    this.name = "EventQuickAddError";
  }
}

export function normalise(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function reject(
  code: EventQuickAddErrorCode,
  input: string,
  start = 0,
  end = input.length,
): never {
  throw new EventQuickAddError(code, normalise(input), [
    { code, start, end, text: input.slice(start, end) },
  ]);
}
