// AUTHORED-BY Codex GPT-6.1-Sol
import { setTimeout as delay } from "node:timers/promises";

/** Bound contention/outage retries: eight attempts with 10–640 ms exponential backoff. */
export async function retryTransition(
  transition: () => Promise<boolean>,
  message: string,
): Promise<void> {
  let cause: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      if (await transition()) return;
    } catch (error) {
      cause = error;
    }
    if (attempt < 7) await delay(10 * 2 ** attempt);
  }
  throw new Error(message, { cause });
}
