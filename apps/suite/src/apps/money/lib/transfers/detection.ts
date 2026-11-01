// AUTHORED-BY Codex GPT-6.1-Sol
import type {
  MoneyTransaction,
  TransferAmbiguity,
  TransferDetection,
  TransferOptions,
  TransferPair,
} from "./types";
import { dateDay, identifier, list, record, requireValue, transaction } from "./validation";

/** Pure suggestions; only mutual sole candidates become one-to-one pairs. */
export function detectTransfers(
  items: readonly MoneyTransaction[],
  options: TransferOptions,
): TransferDetection {
  record(options, ["accountIds", "maxDays"]);
  list(options.accountIds);
  requireValue(options.accountIds.length >= 2);
  const accounts = new Set<string>();
  for (const id of options.accountIds) {
    identifier(id);
    requireValue(!accounts.has(id), "duplicate-id");
    accounts.add(id);
  }
  requireValue(Number.isSafeInteger(options.maxDays) && options.maxDays >= 0, "invalid-window");
  list(items);
  const ids = new Set<string>();
  const entries = items.map((item) => {
    transaction(item);
    requireValue(!ids.has(item.id), "duplicate-id");
    ids.add(item.id);
    requireValue(accounts.has(item.accountId), "unknown-account");
    return { item, day: dateDay(item.date), candidates: [] as string[] };
  });
  const candidates = new Map(entries.map((entry) => [entry.item.id, entry.candidates]));
  for (let left = 0; left < entries.length; left++) {
    // Dense arrays and loop bounds guarantee these entries exist.
    const a = entries[left] as (typeof entries)[number];
    for (let right = left + 1; right < entries.length; right++) {
      const b = entries[right] as (typeof entries)[number];
      if (
        a.item.accountId !== b.item.accountId &&
        a.item.amount !== 0 &&
        a.item.amount === -b.item.amount &&
        a.item.currency === b.item.currency &&
        Math.abs(a.day - b.day) <= options.maxDays
      ) {
        a.candidates.push(b.item.id);
        b.candidates.push(a.item.id);
      }
    }
  }
  const pairs: TransferPair[] = [];
  const ambiguous: TransferAmbiguity[] = [];
  const unmatchedIds: string[] = [];
  for (const { item, candidates: matches } of entries) {
    if (matches.length === 0) {
      unmatchedIds.push(item.id);
    } else if (
      matches.length === 1 &&
      (candidates.get(matches[0] as string) as string[]).length === 1
    ) {
      if (item.amount < 0) pairs.push({ outflowId: item.id, inflowId: matches[0] as string });
    } else {
      ambiguous.push({ transactionId: item.id, candidateIds: [...matches] });
    }
  }
  return { pairs, ambiguous, unmatchedIds };
}
