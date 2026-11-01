// AUTHORED-BY Codex GPT-6.1-Sol
export interface BulkResult<T> {
  done: T[];
  failed: { item: T; error: unknown }[];
}

/** Results retain input order. Individual failures never interrupt the remaining writes. */
export async function runBulk<T>(
  items: readonly T[],
  fn: (item: T) => unknown | Promise<unknown>,
  { concurrency = 4 }: { concurrency?: number } = {},
): Promise<BulkResult<T>> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new TypeError("Invalid bulk concurrency.");
  const results: ({ item: T } | { item: T; error: unknown })[] = [];
  const entries = items.entries();
  async function worker(): Promise<void> {
    for (let next = entries.next(); !next.done; next = entries.next()) {
      const [index, item] = next.value;
      try {
        await fn(item);
        results[index] = { item };
      } catch (error) {
        results[index] = { item, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, concurrency, items.length) }, worker));
  const done: T[] = [];
  const failed: BulkResult<T>["failed"] = [];
  for (const result of results) {
    if ("error" in result) failed.push(result);
    else done.push(result.item);
  }
  return { done, failed };
}

/** Action is past-tense display copy, e.g. "Rescheduled" or "Completed". */
export function bulkSummary(action: string, done: number, failed: number): string {
  return `${action} ${done} ${done === 1 ? "task" : "tasks"}${failed > 0 ? ` · ${failed} failed` : ""}`;
}
