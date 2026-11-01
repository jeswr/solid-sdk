// AUTHORED-BY Codex GPT-6.1-Sol
import type { MoneyTransaction, SplitPart, SplitTransaction } from "./types";
import { amount, identifier, list, record, requireValue, transaction } from "./validation";

function validateParts(original: MoneyTransaction, parts: readonly SplitPart[]): void {
  list(parts);
  requireValue(parts.length >= 2, "invalid-split");
  let total = BigInt(0);
  for (const part of parts) {
    record(part, ["categoryId", "amount"]);
    identifier(part.categoryId);
    amount(part.amount);
    total += BigInt(part.amount);
  }
  requireValue(total === BigInt(original.amount), "split-total-mismatch");
}

/** Keeps an independent original snapshot for lossless unsplitting. No rounding. */
export function splitTransaction(
  original: MoneyTransaction,
  parts: readonly SplitPart[],
): SplitTransaction {
  transaction(original);
  validateParts(original, parts);
  return { transaction: { ...original }, parts: parts.map((part) => ({ ...part })) };
}

/** Reverse one split, validating edited/deserialised parts before restoring the original. */
export function mergeSplit(split: SplitTransaction): MoneyTransaction {
  record(split, ["transaction", "parts"]);
  transaction(split.transaction);
  validateParts(split.transaction, split.parts);
  return { ...split.transaction };
}
