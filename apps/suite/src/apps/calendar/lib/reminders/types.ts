// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

export type ReminderTrigger =
  | { readonly kind: "relative"; readonly offset: string; readonly related?: "start" | "end" }
  | { readonly kind: "absolute"; readonly at: number };

export interface Reminder {
  readonly id: string;
  readonly trigger: ReminderTrigger;
}

/** One resolved occurrence. Recurrence expansion and timezone resolution are caller-owned. */
export interface ReminderEvent {
  readonly id: string;
  readonly occurrenceId: string;
  readonly start: number;
  readonly end?: number;
  readonly reminders: readonly Reminder[];
}

export type Clock = () => number;

export interface ReminderWindow {
  readonly from?: number;
  /** Exclusive end; 8_640_000_000_000_001 is allowed to include the maximum Date instant. */
  readonly to: number;
}

export interface DueReminder {
  readonly key: string;
  readonly eventId: string;
  readonly occurrenceId: string;
  readonly reminderId: string;
  readonly triggerAt: number;
  readonly dueAt: number;
  readonly revision: number;
}

export type ReminderStatus =
  | { readonly status: "snoozed"; readonly until: number; readonly revision: number }
  | { readonly status: "delivered" | "dismissed"; readonly revision: number };

/** Pass a Map; functions return fresh Maps and never mutate caller-owned entries. */
export type ReminderState = ReadonlyMap<string, ReminderStatus>;

export type ReminderAction =
  | { readonly type: "snooze"; readonly key: string; readonly until: number }
  | { readonly type: "dismiss"; readonly key: string }
  | { readonly type: "deliver"; readonly key: string; readonly revision: number };
