// AUTHORED-BY Claude Opus 5.5
import {
  detectRecurring,
  expandRecurring,
  type ForecastTransaction,
  type Recurrence,
} from "../forecast";
import type { Transaction } from "../model";
import { formatMoney, parseMoney } from "../reports";

export interface RecurringPayment {
  /** Stable within one result: account, currency, payee and direction. */
  readonly key: string;
  readonly accountId: string;
  readonly payee: string;
  readonly currency: string;
  /** The latest amount, as a signed decimal string. */
  readonly amount: string;
  readonly recurrence: Recurrence;
  readonly count: number;
  readonly lastDate: string;
  readonly nextDate: string;
}

/** Bills vary a little (energy, phone); larger swings aren't one schedule. */
export const AMOUNT_TOLERANCE_MINOR = 2000;
/** A payment more than this many days past its expected date has probably stopped. */
export const STOPPED_AFTER_DAYS = 7;

const DAY = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * Payments and income that repeat on a regular schedule (at least three times),
 * found in posted transactions. Suggestions only: nothing is written. Transfer
 * legs are left out, and a schedule that has missed its next date by more than
 * a week is treated as stopped.
 */
export function recurringPayments(
  transactions: readonly Transaction[],
  today: string,
): RecurringPayment[] {
  // Detect per account and currency, so one odd row can't hide every schedule.
  const groups = new Map<string, ForecastTransaction[]>();
  for (const row of transactions) {
    if (row.debitAccount || row.creditAccount) continue;
    const payee = (row.payee ?? row.description).trim();
    if (!payee) continue;
    let minor: number;
    try {
      minor = parseMoney(row.currency, row.amount).minor;
    } catch {
      continue;
    }
    const key = JSON.stringify([row.account, row.currency]);
    const group = groups.get(key) ?? [];
    group.push({
      id: row.id,
      accountId: row.account,
      currency: row.currency,
      payee,
      amount: minor,
      date: row.postingTime.slice(0, 10),
    });
    groups.set(key, group);
  }
  const output: RecurringPayment[] = [];
  for (const history of groups.values()) {
    let candidates: ReturnType<typeof detectRecurring>;
    try {
      candidates = detectRecurring(history, { amountTolerance: AMOUNT_TOLERANCE_MINOR });
    } catch {
      continue;
    }
    for (const candidate of candidates) {
      const [next] = expandRecurring(
        [
          {
            id: "next",
            accountId: candidate.accountId,
            currency: candidate.currency,
            payee: candidate.payee,
            amount: candidate.amount,
            // Weekly and yearly schedules count from their first date.
            startDate: candidate.startDate,
            recurrence: candidate.recurrence,
          },
        ],
        { start: addDays(candidate.lastDate, 1), end: addDays(candidate.lastDate, 400) },
      );
      // Every supported schedule repeats within 400 days.
      const nextDate = (next as { date: string }).date;
      if (addDays(nextDate, STOPPED_AFTER_DAYS) < today) continue;
      output.push({
        key: JSON.stringify([
          candidate.accountId,
          candidate.currency,
          candidate.payee,
          Math.sign(candidate.amount),
        ]),
        accountId: candidate.accountId,
        payee: candidate.payee,
        currency: candidate.currency,
        amount: formatMoney({
          currency: candidate.currency as Parameters<typeof formatMoney>[0]["currency"],
          minor: candidate.amount,
        }),
        recurrence: candidate.recurrence,
        count: candidate.transactionIds.length,
        lastDate: candidate.lastDate,
        nextDate,
      });
    }
  }
  return output.sort(
    (a, b) => a.nextDate.localeCompare(b.nextDate) || a.payee.localeCompare(b.payee),
  );
}

const ORDINAL = new Intl.PluralRules("en-GB", { type: "ordinal" });
const SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };

/** "Weekly", "Every 2 weeks", "Monthly on the 12th", "Monthly on the last day", "Yearly". */
export function describeRecurrence(recurrence: Recurrence): string {
  switch (recurrence.frequency) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every 2 weeks";
    case "yearly":
      return "Yearly";
    case "monthly":
      return recurrence.day === "last"
        ? "Monthly on the last day"
        : `Monthly on the ${recurrence.day}${SUFFIX[ORDINAL.select(recurrence.day)]}`;
  }
}
