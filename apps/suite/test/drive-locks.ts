// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { clearTimeout, setTimeout } from "node:timers";

/** Browser-style exclusive, non-re-entrant FIFO locks; deadlocks fail promptly. */
export function exclusiveLocks(timeoutMs = 2_000) {
  const queues = new Map<string, Promise<void>>();
  return {
    request<T>(
      name: string,
      options: LockOptions | ((lock: Lock | null) => T | PromiseLike<T>),
      callback?: (lock: Lock | null) => T | PromiseLike<T>,
    ): Promise<T> {
      const work = typeof options === "function" ? options : callback;
      if (!work) throw new Error("Missing Web Lock callback");
      if (typeof options !== "function" && options.ifAvailable && queues.has(name))
        return Promise.resolve(work(null));
      const previous = queues.get(name) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      queues.set(name, held);
      let expired = false;
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error(`Web Lock timed out: ${name} (possible provisioning deadlock)`));
        }, timeoutMs);
      });
      const pending = previous.then(() => {
        if (expired) throw new Error(`Web Lock request expired: ${name}`);
        // ifAvailable reservations never wait for another holder. Their work
        // may span many network round trips; only blocking flights need the
        // deadlock watchdog once acquired. Keep both kinds non-re-entrant.
        if (typeof options !== "function" && options.ifAvailable) clearTimeout(timer);
        return work({ name, mode: "exclusive" } as Lock);
      });
      // Timing out the caller must not release an active callback's lock.
      void pending.then(release, release);
      void held.then(() => {
        if (queues.get(name) === held) queues.delete(name);
      });
      return Promise.race([pending, timeout]).finally(() => {
        clearTimeout(timer);
      });
    },
  };
}
