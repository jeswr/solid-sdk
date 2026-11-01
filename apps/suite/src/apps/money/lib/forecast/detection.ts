// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { compare, matches } from "./recurrence";
import type {
  DetectionOptions,
  ForecastTransaction,
  Recurrence,
  RecurringCandidate,
} from "./types";
import {
  amount,
  dateDay,
  dateString,
  record,
  requireValue,
  transaction,
  unique,
} from "./validation";

/** Suggestions only: exact payees and dates, no automatic schedule creation. */
export function detectRecurring(
  history: readonly ForecastTransaction[],
  options: DetectionOptions,
): RecurringCandidate[] {
  record(options, ["amountTolerance"]);
  amount(options.amountTolerance);
  requireValue(options.amountTolerance >= 0, "invalid-amount");
  unique(history, transaction);
  const currencies = new Map<string, string>();
  const groups = new Map<string, ForecastTransaction[]>();
  for (const item of history) {
    const previous = currencies.get(item.accountId);
    requireValue(previous === undefined || previous === item.currency, "currency-mismatch");
    currencies.set(item.accountId, item.currency);
    if (item.amount === 0) continue;
    const key = JSON.stringify([item.accountId, item.currency, item.payee, Math.sign(item.amount)]);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const output: RecurringCandidate[] = [];
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    group.sort((a, b) => compare(a.date, b.date) || compare(a.id, b.id));
    const first = group[0]!;
    const last = group[group.length - 1]!;
    let min = BigInt(first.amount);
    let max = min;
    for (const item of group) {
      const value = BigInt(item.amount);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (max - min > BigInt(options.amountTolerance)) continue;
    const rules: Recurrence[] = [
      { frequency: "weekly" },
      { frequency: "biweekly" },
      { frequency: "monthly", day: "last" },
      { frequency: "monthly", day: Number(first.date.slice(8)) },
      { frequency: "yearly" },
    ];
    const rule = rules.find((candidate) => {
      let observed = 0;
      const end = dateDay(last.date);
      for (let day = dateDay(first.date); day <= end; day++) {
        const date = dateString(day);
        if (!matches(date, first.date, candidate)) continue;
        if (date !== group[observed]!.date) return false;
        observed++;
      }
      return observed === group.length;
    });
    if (!rule) continue;
    output.push({
      accountId: first.accountId,
      currency: first.currency,
      payee: first.payee,
      amount: last.amount,
      startDate: first.date,
      lastDate: last.date,
      recurrence: rule,
      transactionIds: group.map((item) => item.id),
    });
  }
  return output.sort(
    (a, b) =>
      compare(a.accountId, b.accountId) ||
      compare(a.currency, b.currency) ||
      compare(a.payee, b.payee) ||
      a.amount - b.amount,
  );
}
