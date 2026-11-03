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
  /** The latest amount close to the usual one, as a signed decimal string. */
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
/** Banks move a payment up to this many days either way (weekends, bank holidays). */
export const SHIFT_DAYS = 3;
/** A payment more than this many days past its expected date has probably stopped. */
export const STOPPED_AFTER_DAYS = 7;
/** The latest few payments to a payee may be one-offs, so a schedule is tried from each. */
const ANCHORS = 3;
/** Nearest first, so on a tie a payment counts as on time. */
const SHIFTS = [0, 1, -1, 2, -2, 3, -3];

interface Payment {
  readonly day: number;
  readonly minor: number;
}

interface Run {
  readonly rule: Recurrence;
  /** The schedule's latest expected date. */
  readonly anchor: number;
  /** Indexes into the payee's payments, latest first. */
  readonly indexes: readonly number[];
  /** How many payments landed exactly on their expected date. */
  readonly exact: number;
  /** The latest payment within the amount tolerance: the schedule's amount. */
  readonly amount: number;
}

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const utcDay = (year: number, month: number, date: number) => Date.UTC(year, month, date) / DAY;
const lastOfMonth = (day: number) => new Date((day + 1) * DAY).getUTCDate() === 1;

/** The next (or previous) date on a schedule, from a date on it. */
function step(day: number, rule: Recurrence, direction: 1 | -1): number | undefined {
  const date = new Date(day * DAY);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (rule.frequency) {
    case "weekly":
      return day + 7 * direction;
    case "biweekly":
      return day + 14 * direction;
    case "monthly": {
      if (rule.day === "last") return utcDay(year, month + direction + 1, 0);
      // A 29th, 30th or 31st skips the months without one; every second month has a 31st.
      for (let months = direction; ; months += direction) {
        const next = utcDay(year, month + months, rule.day);
        if (new Date(next * DAY).getUTCDate() === rule.day) return next;
      }
    }
    case "yearly": {
      // 29 February returns within four years, except across a century that isn't a leap year.
      for (let years = 1; years <= 4; years++) {
        const next = utcDay(year + years * direction, month, date.getUTCDate());
        if (new Date(next * DAY).getUTCMonth() === month) return next;
      }
      return undefined;
    }
  }
}

function rulesFor(anchor: number): Recurrence[] {
  return [
    { frequency: "weekly" },
    { frequency: "biweekly" },
    ...(lastOfMonth(anchor) ? [{ frequency: "monthly", day: "last" } as const] : []),
    { frequency: "monthly", day: new Date(anchor * DAY).getUTCDate() },
    { frequency: "yearly" },
  ];
}

/** The unused payment closest to `expected` (earliest on a tie), within SHIFT_DAYS either way. */
function nearest(
  payments: readonly Payment[],
  used: ReadonlySet<number>,
  from: number,
  expected: number,
  fits: (payment: Payment) => boolean,
): number | undefined {
  let found: number | undefined;
  let distance = SHIFT_DAYS + 1;
  for (let index = from; index >= 0; index--) {
    const payment = payments[index] as Payment;
    if (payment.day < expected - SHIFT_DAYS) break;
    const gap = Math.abs(payment.day - expected);
    if (payment.day <= expected + SHIFT_DAYS && !used.has(index) && fits(payment)) {
      if (gap <= distance) {
        found = index;
        distance = gap;
      }
    }
  }
  return found;
}

const toleranceFor = (minor: number, floor: number) =>
  Math.max(Math.round(Math.abs(minor) * AMOUNT_TOLERANCE), floor);

/**
 * Walks back from one payment through the dates a schedule expects, taking the
 * unused payment nearest each date (up to SHIFT_DAYS early or late) whose amount
 * is close to the latest one. Payments between those dates are skipped as
 * one-offs; the run ends at the first expected date with no payment.
 */
function walk(
  payments: readonly Payment[],
  used: ReadonlySet<number>,
  start: number,
  anchor: number,
  rule: Recurrence,
  floor: number,
): Run {
  const amount = (payments[start] as Payment).minor;
  const tolerance = toleranceFor(amount, floor);
  const fits = (payment: Payment) => Math.abs(payment.minor - amount) <= tolerance;
  const indexes = [start];
  let exact = (payments[start] as Payment).day === anchor ? 1 : 0;
  let expected = anchor;
  let cursor = start - 1;
  for (;;) {
    const previous = step(expected, rule, -1);
    if (previous === undefined) break;
    while (cursor >= 0 && (payments[cursor] as Payment).day > previous + SHIFT_DAYS) cursor--;
    const found = nearest(payments, used, cursor, previous, fits);
    if (found === undefined) break;
    indexes.push(found);
    if ((payments[found] as Payment).day === previous) exact++;
    cursor = found - 1;
    expected = previous;
  }
  return { rule, anchor, indexes, exact, amount };
}

/** A payment off its date counts for a quarter, so moved dates don't invent a schedule. */
const score = (run: Run) => run.exact + (run.indexes.length - run.exact) / 4;
const better = (run: Run, best: Run | undefined) => !best || score(run) > score(best);

/**
 * The schedules in one payee's payments (sorted by date). Each pass keeps the
 * best run (most payments, mostly on their exact dates), then looks
 * again among the rest, so two schedules with one payee (pay on the 1st and the
 * 15th) are both found. A run with more one-off payments of a similar amount
 * inside it than on schedule is no schedule (a daily coffee is not seven weekly
 * ones), and the search stops there.
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
      for (const shift of SHIFTS) {
        for (const rule of rulesFor(day - shift)) {
          const run = walk(payments, used, index, day - shift, rule, floor);
          if (better(run, best)) best = run;
        }
      }
    }
    if (!best || best.indexes.length < 3) return runs;
    const run: Run = best;
    const first = (payments[run.indexes.at(-1) as number] as Payment).day;
    const inRun = new Set(run.indexes);
    const tolerance = toleranceFor(run.amount, floor);
    let strays = 0;
    payments.forEach((payment, index) => {
      if (used.has(index) || inRun.has(index) || payment.day < first) return;
      if (payment.day > run.anchor + SHIFT_DAYS) return;
      if (Math.abs(payment.minor - run.amount) <= tolerance) strays++;
    });
    if (strays > run.indexes.length) return runs;
    for (const index of run.indexes) used.add(index);
    // A payment on the next date of any amount (a price rise) keeps the schedule going.
    let anchor = run.anchor;
    const indexes = [...run.indexes];
    for (;;) {
      const next = step(anchor, run.rule, 1);
      if (next === undefined) break;
      const found = nearest(payments, used, payments.length - 1, next, () => true);
      if (found === undefined) break;
      used.add(found);
      indexes.unshift(found);
      anchor = next;
    }
    runs.push({ ...run, anchor, indexes });
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
      const next = step(run.anchor, run.rule, 1);
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
          minor: run.amount,
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
