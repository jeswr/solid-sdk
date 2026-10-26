// AUTHORED-BY Codex GPT-6.1-Sol
import type { MoneyTransaction, TransferMatch, TransferOptions } from "./types";
import { dateDay, identifier, record, requireValue, transactions } from "./validation";

/** Rejects ambiguous candidates instead of guessing financial links. No mutation or FX. */
export function detectTransfers(
  items: readonly MoneyTransaction[],
  options: TransferOptions,
): readonly TransferMatch[] {
  transactions(items);
  record(options, ["accountIds", "maxDays"]);
  requireValue(Array.isArray(options.accountIds) && options.accountIds.length === 2);
  const [first, second] = options.accountIds;
  identifier(first);
  identifier(second);
  requireValue(first !== second);
  requireValue(Number.isSafeInteger(options.maxDays) && options.maxDays >= 0);
  const candidates = new Map<string, string[]>();
  const dates = items.map((item) => {
    requireValue(options.accountIds.includes(item.accountId), "scope-mismatch");
    candidates.set(item.id, []);
    return dateDay(item.date);
  });
  for (let left = 0; left < items.length; left++) {
    // Indices are bounded by the loop; assertion does not reinterpret input.
    const a = items[left] as MoneyTransaction;
    for (let right = left + 1; right < items.length; right++) {
      const b = items[right] as MoneyTransaction;
      if (
        a.accountId !== b.accountId &&
        a.amount !== 0 &&
        a.amount === -b.amount &&
        a.currency === b.currency &&
        Math.abs((dates[left] as number) - (dates[right] as number)) <= options.maxDays
      ) {
        (candidates.get(a.id) as string[]).push(b.id);
        (candidates.get(b.id) as string[]).push(a.id);
      }
    }
  }
  for (const ids of candidates.values()) {
    requireValue(ids.length <= 1, "ambiguous-transfer");
  }
  const result: TransferMatch[] = [];
  for (const item of items) {
    const ids = candidates.get(item.id) as string[];
    if (item.amount < 0 && ids.length === 1) {
      result.push({ outflowId: item.id, inflowId: ids[0] as string });
    }
  }
  return result;
}
