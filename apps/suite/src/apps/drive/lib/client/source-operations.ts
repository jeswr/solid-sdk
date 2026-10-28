// AUTHORED-BY Codex
const active = new Set<string>();

export class DriveOperationInProgressError extends Error {
  readonly kind = "operation-in-progress";
  constructor(readonly url: string) {
    super(
      "An operation for this item is already in progress. Wait for it to finish and try again.",
    );
    this.name = "DriveOperationInProgressError";
  }
}

/** Reserve before any asynchronous work. Only the explicitly scoped client owns these URLs. */
export async function sourceOperation<T>(
  urls: readonly string[],
  work: (held: ReadonlySet<string>) => Promise<T>,
  held: ReadonlySet<string> = new Set(),
): Promise<T> {
  const requested = [...new Set(urls)].filter((url) => !held.has(url)).sort();
  for (const url of requested) if (active.has(url)) throw new DriveOperationInProgressError(url);
  for (const url of requested) active.add(url);
  const scope = new Set([...held, ...requested]);
  const acquire = async (index: number): Promise<T> => {
    const url = requested[index];
    if (url === undefined) return work(scope);
    const locks = globalThis.navigator?.locks;
    if (!locks) return acquire(index + 1);
    return locks.request(`solid-drive:source:${url}`, { ifAvailable: true }, (lock) => {
      if (!lock) throw new DriveOperationInProgressError(url);
      return acquire(index + 1);
    });
  };
  try {
    return await acquire(0);
  } finally {
    for (const url of requested) active.delete(url);
  }
}
