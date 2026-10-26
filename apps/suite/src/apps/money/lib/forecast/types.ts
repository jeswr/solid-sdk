// AUTHORED-BY Codex GPT-6.1-Sol

/** Gregorian civil dates YYYY-MM-DD, years 0001–9999; both boundaries inclusive. */
export interface DateRange {
  readonly start: string;
  readonly end: string;
}

export type Recurrence =
  | { readonly frequency: "weekly" | "biweekly" | "yearly" }
  | { readonly frequency: "monthly"; readonly day: number | "last" };

/** Signed safe integer amount in the account currency's minor units. */
export interface RecurringTemplate {
  readonly id: string;
  readonly accountId: string;
  readonly currency: string;
  readonly payee: string;
  readonly amount: number;
  readonly startDate: string;
  readonly endDate?: string;
  readonly recurrence: Recurrence;
}

export interface Occurrence {
  readonly templateId: string;
  readonly accountId: string;
  readonly currency: string;
  readonly payee: string;
  readonly amount: number;
  readonly date: string;
}

export interface ForecastAccount {
  readonly id: string;
  readonly currency: string;
  /** Balance immediately before range.start; no earlier transactions are applied. */
  readonly openingBalance: number;
}

/** Explicit one-off activity for forecasts, or historical activity for detection. */
export interface ForecastTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly currency: string;
  readonly payee: string;
  readonly amount: number;
  readonly date: string;
}

export interface DailyBalance {
  readonly accountId: string;
  readonly currency: string;
  readonly date: string;
  readonly change: number;
  /** Closing balance after all activity on this date. */
  readonly balance: number;
}

export interface DetectionOptions {
  /** Maximum absolute difference between any two amounts in a candidate group. */
  readonly amountTolerance: number;
}

export interface RecurringCandidate {
  readonly accountId: string;
  readonly currency: string;
  readonly payee: string;
  /** Latest observed amount, without averaging or rounding. */
  readonly amount: number;
  readonly startDate: string;
  readonly lastDate: string;
  readonly recurrence: Recurrence;
  readonly transactionIds: readonly string[];
}
