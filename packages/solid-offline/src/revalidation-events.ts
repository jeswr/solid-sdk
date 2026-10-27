// AUTHORED-BY Codex GPT-6.1-Sol
import type { Broadcaster } from './swr.js';
import type { RevalidationEvent } from './types.js';

type TerminalEvent = 'updated' | Exclude<RevalidationEvent['event'], 'revalidating'>;

/** Pair every started attempt with one URL-only outcome, including storage/fetch failures. */
export async function reportRevalidation<T>(
  url: string,
  broadcast: Broadcaster,
  run: () => Promise<T>,
  eventFor: (result: T) => TerminalEvent,
): Promise<T> {
  broadcast.postMessage({ url, event: 'revalidating' });
  let event: TerminalEvent = 'revalidate-failed';
  try {
    const result = await run();
    event = eventFor(result);
    return result;
  } finally {
    broadcast.postMessage({ url, event });
  }
}
