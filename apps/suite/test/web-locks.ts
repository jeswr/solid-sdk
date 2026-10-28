// AUTHORED-BY Codex
/** Browser-style exclusive locks: a nested request queues behind its caller. */
export function exclusiveWebLocks() {
  const queues = new Map<string, Promise<void>>();
  const held = new Set<string>();
  const nested: { name: string; held: string[] }[] = [];
  const request = <T>(name: string, work: (lock: Lock) => T | PromiseLike<T>) => {
    if (held.size) nested.push({ name, held: [...held] });
    const previous = queues.get(name) ?? Promise.resolve();
    const pending = previous.then(async () => {
      held.add(name);
      try {
        return await work({ name, mode: "exclusive" });
      } finally {
        held.delete(name);
      }
    });
    // Rejections release the lock just as fulfillment does.
    const released = pending.then(
      () => {},
      () => {},
    );
    queues.set(name, released);
    void released.then(() => {
      if (queues.get(name) === released) queues.delete(name);
    });
    return pending;
  };
  return { request, nested };
}
