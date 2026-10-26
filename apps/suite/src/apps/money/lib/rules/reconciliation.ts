// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReconciliationInput, ReconciliationResult } from "./types";
import {
  currency,
  dateDay,
  identifier,
  minorUnits,
  record,
  requireValue,
  safeBalance,
  transactions,
} from "./validation";

/** Plans marking only; caller owns the complete scoped ledger and persistence. */
export function reconcile(input: ReconciliationInput): ReconciliationResult {
  record(input, [
    "accountId",
    "currency",
    "openingBalance",
    "statementBalance",
    "statementDate",
    "transactions",
  ]);
  identifier(input.accountId);
  currency(input.currency);
  minorUnits(input.openingBalance);
  minorUnits(input.statementBalance);
  const through = dateDay(input.statementDate);
  transactions(input.transactions);
  let balance = BigInt(input.openingBalance);
  const ids: string[] = [];
  for (const item of input.transactions) {
    requireValue(
      item.accountId === input.accountId && item.currency === input.currency,
      "scope-mismatch",
    );
    if (dateDay(item.date) <= through && item.status !== "uncleared") {
      balance += BigInt(item.amount);
      if (item.status === "cleared") ids.push(item.id);
    }
  }
  const clearedBalance = safeBalance(balance);
  const difference = safeBalance(BigInt(input.statementBalance) - balance);
  return {
    clearedBalance,
    difference,
    balanced: difference === 0,
    transactionIdsToReconcile: difference === 0 ? ids : [],
  };
}
