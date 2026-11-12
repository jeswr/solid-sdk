// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
 * work and discard their queued jobs before starting another request. `priority` jobs (an
 * interactive view) start before queued normal jobs, but never preempt running ones.
 * Never call the mapper from inside one of its own jobs: once every slot is held, the nested
 * jobs wait for slots that their callers hold, and both deadlock. */
export type ConcurrentMapper = <T, U>(
  items: readonly T[],
  work: (item: T) => Promise<U>,
  options?: { priority?: boolean },
) => Promise<U[]>;

export function createConcurrentMapper(concurrency = 6): ConcurrentMapper {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new RangeError("Invalid concurrency");
  let active = 0;
  const urgent: (() => void)[] = [];
  const queue: (() => void)[] = [];
  async function run<U>(work: () => Promise<U>, priority: boolean): Promise<U> {
    if (active >= concurrency)
      await new Promise<void>((resolve) => (priority ? urgent : queue).push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      const next = urgent.shift() ?? queue.shift();
      if (next) next();
      else active--;
    }
  }
  return async (items, work, { priority = false } = {}) => {
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
        }, priority),
      ),
    );
    if (failed) throw failure;
    return results.map(
      (result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof work>>>).value,
    );
  };
}
