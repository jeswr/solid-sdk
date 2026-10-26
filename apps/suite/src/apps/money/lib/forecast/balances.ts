// AUTHORED-BY Codex GPT-6.1-Sol
import { compare, expandRecurring } from "./recurrence";
import type {
  DailyBalance,
  DateRange,
  ForecastAccount,
  ForecastTransaction,
  RecurringTemplate,
} from "./types";
import {
  amount,
  checked,
  currency,
  dateDay,
  dateString,
  identifier,
  record,
  requireValue,
  transaction,
  unique,
} from "./validation";

export function forecastBalances(
  accounts: readonly ForecastAccount[],
  templates: readonly RecurringTemplate[],
  transactions: readonly ForecastTransaction[],
  period: DateRange,
): DailyBalance[] {
  unique(accounts, (value) => {
    record(value, ["id", "currency", "openingBalance"]);
    identifier(value.id);
    currency(value.currency);
    amount(value.openingBalance);
  });
  unique(transactions, transaction);
  const occurrences = expandRecurring(templates, period);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  // Validate scope even for templates/transactions with no in-range occurrences.
  for (const item of [...templates, ...transactions]) {
    const account = accountMap.get(item.accountId);
    requireValue(account, "unknown-account");
    requireValue(account.currency === item.currency, "currency-mismatch");
  }
  const changes = new Map<string, Map<string, bigint>>();
  for (const item of [...occurrences, ...transactions]) {
    if (item.date < period.start || item.date > period.end) continue;
    let days = changes.get(item.accountId);
    if (!days) {
      days = new Map();
      changes.set(item.accountId, days);
    }
    days.set(item.date, (days.get(item.date) ?? BigInt(0)) + BigInt(item.amount));
  }
  const output: DailyBalance[] = [];
  for (const account of [...accounts].sort((a, b) => compare(a.id, b.id))) {
    let balance = BigInt(account.openingBalance);
    for (let day = dateDay(period.start); day <= dateDay(period.end); day++) {
      const date = dateString(day);
      const change = changes.get(account.id)?.get(date) ?? BigInt(0);
      balance += change;
      output.push({
        accountId: account.id,
        currency: account.currency,
        date,
        change: checked(change),
        balance: checked(balance),
      });
    }
  }
  return output;
}
