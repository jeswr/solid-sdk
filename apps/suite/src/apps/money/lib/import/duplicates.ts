// AUTHORED-BY Codex GPT-6.1-Sol
import type { ImportedTransaction } from "./types";
import { parseAmount, parseDate } from "./values";

function tuple(transaction: ImportedTransaction): string {
  return JSON.stringify([
    parseDate(transaction.date, "YYYY-MM-DD"),
    parseAmount(transaction.amount),
    transaction.description.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
  ]);
}

/** Stable non-cryptographic FNV-1a hash of the canonical date/amount/description tuple. */
export function transactionHash(transaction: ImportedTransaction): string {
  let hash = 0x811c9dc5;
  for (const char of tuple(transaction))
    hash = Math.imul(hash ^ (char.codePointAt(0) as number), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Compare one account/currency at a time; confirm hash matches with the tuple itself. */
export function detectDuplicates(
  incoming: readonly ImportedTransaction[],
  existing: readonly ImportedTransaction[] = [],
): { unique: ImportedTransaction[]; duplicates: ImportedTransaction[] } {
  const seen = new Map<string, Set<string>>();
  const remember = (transaction: ImportedTransaction): boolean => {
    const hash = transactionHash(transaction);
    const key = tuple(transaction);
    const bucket = seen.get(hash) ?? new Set<string>();
    const duplicate = bucket.has(key);
    bucket.add(key);
    seen.set(hash, bucket);
    return duplicate;
  };
  for (const transaction of existing) remember(transaction);
  const unique: ImportedTransaction[] = [];
  const duplicates: ImportedTransaction[] = [];
  for (const transaction of incoming) {
    (remember(transaction) ? duplicates : unique).push(transaction);
  }
  return { unique, duplicates };
}
