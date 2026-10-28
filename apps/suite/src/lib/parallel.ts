// AUTHORED-BY Codex
/** Bounded groups; drain failed groups before callers can start recovery work. */
export async function mapConcurrent<T, U>(
  items: readonly T[],
  work: (item: T) => Promise<U>,
  concurrency = 8,
): Promise<U[]> {
  const values: U[] = [];
  for (let start = 0; start < items.length; start += concurrency) {
    const group = await Promise.allSettled(
      items
        .slice(start, start + concurrency)
        .map((item) => Promise.resolve().then(() => work(item))),
    );
    for (const result of group) {
      if (result.status === "rejected") throw result.reason;
      values.push(result.value);
    }
  }
  return values;
}
