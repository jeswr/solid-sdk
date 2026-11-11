// AUTHORED-BY Codex GPT-6.1-Sol
import type { SessionFence } from "@jeswr/reactive-authentication";
import { boundProxy } from "./bound-proxy.js";

/**
 * Lock order: namespace mutation, engine fence, credential catalog. Logout holds the namespace
 * lock through all of the engine's separate supersessions and revocations. Commits take it
 * before the engine's shared fence lock, so cleanup never waits on a commit waiting on cleanup.
 * Keep supersede unwrapped: provider cleanup calls it while already holding the namespace lock.
 */
export function namespaceFence(
  fence: SessionFence,
  exclusive: <T>(work: () => Promise<T>) => Promise<T>,
): SessionFence {
  const commit: SessionFence["commit"] = (expected, write, signal) =>
    exclusive(() => fence.commit(expected, write, signal));
  return boundProxy(fence, { commit });
}
