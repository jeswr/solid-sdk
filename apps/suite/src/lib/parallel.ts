// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6.1-Sol
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

/** One queue can bound reads across concurrent pages and rooms. Failed maps drain in-flight
 * work and discard their queued jobs before starting another request. */
export type ConcurrentMapper = <T, U>(
  items: readonly T[],
  work: (item: T) => Promise<U>,
) => Promise<U[]>;

export function createConcurrentMapper(concurrency = 6): ConcurrentMapper {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new RangeError("Invalid concurrency");
  let active = 0;
  const queue: (() => void)[] = [];
  async function run<U>(work: () => Promise<U>): Promise<U> {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  }
  return async (items, work) => {
    let failed = false;
    let failure: unknown;
    const results = await Promise.allSettled(
      items.map((item) =>
        run(async () => {
          if (failed) throw failure;
          try {
            return await work(item);
          } catch (error) {
            failed = true;
            failure = error;
            throw error;
          }
        }),
      ),
    );
    if (failed) throw failure;
    return results.map(
      (result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof work>>>).value,
    );
  };
}
