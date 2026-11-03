// AUTHORED-BY Claude Opus 5.5
import type { Recurrence } from "../forecast";
import type { Transaction } from "../model";
import { formatMoney, minorUnits, parseMoney } from "../reports";

export interface RecurringPayment {
  /** Unique within one result. */
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
  /** The next date (plus a few days' grace) has passed without the payment. */
  readonly late: boolean;
}

/** Bills vary (energy, phone): amounts within a fifth of the latest one still count. */
export const AMOUNT_TOLERANCE = 0.2;
/** Small payments may vary by this many whole currency units. */
export const AMOUNT_TOLERANCE_FLOOR = 5;
/** Banks take a payment up to this many days late (weekends, bank holidays). */
export const SHIFT_DAYS = 3;
/** A payment more than this many days past its expected date has probably stopped. */
export const STOPPED_AFTER_DAYS = 7;
/** The latest few payments to a payee may be one-offs, so a schedule is tried from each. */
const ANCHORS = 3;
/** Every supported schedule repeats within this many days (a 29 February one within four years). */
const HORIZON_DAYS = 1500;

interface Payment {
  readonly day: number;
  readonly minor: number;
}

interface Run {
  readonly rule: Recurrence;
  readonly anchor: number;
  /** Indexes into the payee's payments, latest first. */
  readonly indexes: readonly number[];
}

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const lastOfMonth = (day: number) => dateOf(day + 1).endsWith("-01");

function onSchedule(day: number, anchor: number, rule: Recurrence): boolean {
  switch (rule.frequency) {
    case "weekly":
      return (anchor - day) % 7 === 0;
    case "biweekly":
      return (anchor - day) % 14 === 0;
    case "yearly":
      return dateOf(day).slice(5) === dateOf(anchor).slice(5);
    case "monthly":
      return rule.day === "last" ? lastOfMonth(day) : Number(dateOf(day).slice(8)) === rule.day;
  }
}

function step(day: number, anchor: number, rule: Recurrence, direction: 1 | -1) {
  for (let next = day + direction; Math.abs(next - day) <= HORIZON_DAYS; next += direction) {
    if (onSchedule(next, anchor, rule)) return next;
  }
  return undefined;
}

function rulesFor(anchor: number): Recurrence[] {
  // "Last day" first: on a tie it also covers the 30th in a 31-day month.
  return [
    { frequency: "weekly" },
    { frequency: "biweekly" },
    ...(lastOfMonth(anchor) ? [{ frequency: "monthly", day: "last" } as const] : []),
    { frequency: "monthly", day: Number(dateOf(anchor).slice(8)) },
    { frequency: "yearly" },
  ];
}

/**
 * Walks back from one payment through the dates a schedule expects, taking the
 * earliest unused payment within SHIFT_DAYS after each date whose amount is close
 * to the latest one. Payments between those dates are skipped as one-offs; the
 * run ends at the first expected date with no payment.
 */
function walk(
  payments: readonly Payment[],
  used: ReadonlySet<number>,
  start: number,
  anchor: number,
  rule: Recurrence,
  floor: number,
): Run {
  const latest = (payments[start] as Payment).minor;
  const tolerance = Math.max(Math.round(Math.abs(latest) * AMOUNT_TOLERANCE), floor);
  const indexes = [start];
  let expected = anchor;
  let cursor = start - 1;
  for (;;) {
    const previous = step(expected, anchor, rule, -1);
    if (previous === undefined) break;
    while (cursor >= 0 && (payments[cursor] as Payment).day > previous + SHIFT_DAYS) cursor--;
    let found: number | undefined;
    for (let index = cursor; index >= 0; index--) {
      const payment = payments[index] as Payment;
      if (payment.day < previous) break;
      if (!used.has(index) && Math.abs(payment.minor - latest) <= tolerance) found = index;
    }
    if (found === undefined) break;
    indexes.push(found);
    cursor = found - 1;
    expected = previous;
  }
  return { rule, anchor, indexes };
}

/**
 * The schedules in one payee's payments (sorted by date), latest run first. Each
 * pass keeps the run with the most payments, then looks again among the rest, so
 * two schedules with one payee (pay on the 1st and the 15th) are both found. A run
 * with more one-off payments inside it than on schedule is no schedule at all (a
 * daily coffee is not seven weekly ones), and the search stops there.
 */
function schedules(payments: readonly Payment[], floor: number): Run[] {
  const used = new Set<number>();
  const runs: Run[] = [];
  for (;;) {
    let best: Run | undefined;
    let anchors = 0;
    for (let index = payments.length - 1; index >= 0 && anchors < ANCHORS; index--) {
      if (used.has(index)) continue;
      anchors++;
      const day = (payments[index] as Payment).day;
      for (let shift = 0; shift <= SHIFT_DAYS; shift++) {
        for (const rule of rulesFor(day - shift)) {
          const run = walk(payments, used, index, day - shift, rule, floor);
          if (!best || run.indexes.length > best.indexes.length) best = run;
        }
      }
    }
    if (!best || best.indexes.length < 3) return runs;
    const first = (payments[best.indexes.at(-1) as number] as Payment).day;
    const inRun = new Set(best.indexes);
    let strays = 0;
    payments.forEach((payment, index) => {
      if (payment.day >= first && payment.day <= best.anchor + SHIFT_DAYS) {
        if (!used.has(index) && !inRun.has(index)) strays++;
      }
    });
    if (strays > best.indexes.length) return runs;
    runs.push(best);
    for (const index of best.indexes) used.add(index);
  }
}

/**
 * Payments and income that repeat on a regular schedule (at least three times),
 * found in posted transactions. Suggestions only: nothing is written. Transfer
 * legs and unreadable rows are left out, and a schedule that has missed its next
 * date by more than a week is treated as stopped.
 */
export function recurringPayments(
  transactions: readonly Transaction[],
  today: string,
): RecurringPayment[] {
  const groups = new Map<
    string,
    { accountId: string; currency: string; payee: string; payments: (Payment & { id: string })[] }
  >();
  for (const row of transactions) {
    if (row.debitAccount || row.creditAccount) continue;
    const payee = row.payee?.trim() || row.description.trim();
    const date = row.postingTime.slice(0, 10);
    const day = Date.parse(`${date}T00:00:00Z`) / DAY;
    if (!payee || !DATE.test(date) || !Number.isInteger(day) || dateOf(day) !== date) continue;
    let minor: number;
    try {
      minor = parseMoney(row.currency, row.amount).minor;
    } catch {
      continue;
    }
    if (minor === 0) continue;
    const key = JSON.stringify([row.account, row.currency, payee, Math.sign(minor)]);
    const group = groups.get(key) ?? {
      accountId: row.account,
      currency: row.currency,
      payee,
      payments: [],
    };
    group.payments.push({ id: row.id, day, minor });
    groups.set(key, group);
  }
  const output: RecurringPayment[] = [];
  const todayDay = Date.parse(`${today}T00:00:00Z`) / DAY;
  for (const [key, group] of groups) {
    const payments = group.payments.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
    const floor = AMOUNT_TOLERANCE_FLOOR * 10 ** minorUnits(group.currency);
    schedules(payments, floor).forEach((run, index) => {
      const next = step(run.anchor, run.anchor, run.rule, 1);
      // 29 February in a century year that isn't a leap year.
      if (next === undefined || next + STOPPED_AFTER_DAYS < todayDay) return;
      const latest = payments[run.indexes[0] as number] as Payment;
      output.push({
        key: `${key}#${index}`,
        accountId: group.accountId,
        payee: group.payee,
        currency: group.currency,
        amount: formatMoney({
          currency: group.currency as Parameters<typeof formatMoney>[0]["currency"],
          minor: latest.minor,
        }),
        recurrence: run.rule,
        count: run.indexes.length,
        lastDate: dateOf(latest.day),
        nextDate: dateOf(next),
        late: next + SHIFT_DAYS < todayDay,
      });
    });
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
