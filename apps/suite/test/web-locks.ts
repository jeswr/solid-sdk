// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { exclusiveLocks } from "./drive-locks";

/** Browser-style exclusive locks: a nested request queues behind its caller. */
export function exclusiveWebLocks() {
  const locks = exclusiveLocks();
  const held = new Set<string>();
  const nested: { name: string; held: string[] }[] = [];
  const request = <T>(
    name: string,
    options: LockOptions | ((lock: Lock | null) => T | PromiseLike<T>),
    callback?: (lock: Lock | null) => T | PromiseLike<T>,
  ) => {
    const work = typeof options === "function" ? options : callback;
    if (!work) throw new Error("Missing Web Lock callback");
    if (held.size) nested.push({ name, held: [...held] });
    const run = async (lock: Lock | null) => {
      if (!lock) return work(null);
      held.add(name);
      try {
        return await work(lock);
      } finally {
        held.delete(name);
      }
    };
    return typeof options === "function"
      ? locks.request(name, run)
      : locks.request(name, options, run);
  };
  return { request, nested };
}
