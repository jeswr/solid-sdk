// AUTHORED-BY Codex GPT-6
import { AsyncLocalStorage } from "node:async_hooks";

// Limits travel through the normal PodPort methods, including decorators. Only
// the fetch adapter consumes this context; callers never recover its transport.
const operations = new AsyncLocalStorage<(fetcher: typeof fetch) => typeof fetch>();

export function withPodFetchLimits<T>(
  wrap: (fetcher: typeof fetch) => typeof fetch,
  operation: () => T,
): T {
  return operations.run(wrap, operation);
}

export function podOperationFetch(fetcher: typeof fetch): typeof fetch {
  return operations.getStore()?.(fetcher) ?? fetcher;
}

export function hasPodFetchLimits(): boolean {
  return operations.getStore() !== undefined;
}
