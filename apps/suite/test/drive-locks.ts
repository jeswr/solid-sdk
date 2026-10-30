// AUTHORED-BY Codex
import { clearTimeout, setTimeout } from "node:timers";

/** Browser-style exclusive, non-re-entrant FIFO locks; queued deadlocks fail promptly. */
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
        return Promise.resolve().then(() => work(null));
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
        // A Web Lock remains held until its callback settles, including slow IO.
        // Only waiting to acquire it can be a lock deadlock; nested acquisitions
        // still have their own deadline. Never abandon an active mutation.
        clearTimeout(timer);
        return work({ name, mode: "exclusive" } as Lock);
      });
      // An expired queued request releases its place only after its predecessor.
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
