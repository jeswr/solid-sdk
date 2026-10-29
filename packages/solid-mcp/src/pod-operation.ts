// AUTHORED-BY Codex GPT-6
import { AsyncLocalStorage } from "node:async_hooks";
import { limitedBody, mediaType, RDF_MEDIA_TYPES } from "./content.js";

// Limits travel through the normal PodPort methods, including decorators. Only
// the fetch adapter consumes this context; callers never recover its transport.
const operations = new AsyncLocalStorage<(fetcher: typeof fetch) => typeof fetch>();
type ReadMode = "complete" | "fetch" | "fetch-complete" | "authorization";
const readModes = new AsyncLocalStorage<ReadMode>();

export const POD_READ_TIMEOUT_MS = 5000;

/** Only known native reads may omit bodies or receive a truncated fetch prefix. */
export function withPodReadMode<T>(mode: ReadMode, operation: () => T): T {
  return readModes.run(mode, operation);
}

export function podReadMode(): ReadMode {
  return readModes.getStore() ?? "complete";
}

/** One deadline and bounded transport for the initial read and all projection reads. */
export async function withPodReadLimits<T>(operation: () => Promise<T>): Promise<T> {
  // Search supplies its own (possibly tighter) deadline and streaming budget.
  if (hasPodFetchLimits()) return operation();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Pod read deadline reached."));
    }, POD_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      withPodFetchLimits((fetcher) => boundedFetch(fetcher, controller.signal), operation),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function boundedFetch(fetcher: typeof fetch, operationSignal: AbortSignal): typeof fetch {
  return async (input, init) => {
    const suppliedSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const signal = suppliedSignal
      ? AbortSignal.any([suppliedSignal, operationSignal])
      : operationSignal;
    signal.throwIfAborted();
    const response = await fetcher(input, { ...init, signal });
    if (signal.aborted) {
      void response.body?.cancel().catch(() => {});
      signal.throwIfAborted();
    }
    // Scope/status checks own redirects and errors; do not read their bodies.
    if (!response.ok) return response;
    const mode = podReadMode();
    const contentType = mediaType(response.headers.get("content-type"));
    let body: Uint8Array | null = null;
    if (
      mode === "authorization" ||
      (mode === "fetch" && !RDF_MEDIA_TYPES.has(contentType) && !contentType.startsWith("text/"))
    ) {
      void response.body?.cancel().catch(() => {});
    } else {
      const limited = await limitedBody(response, signal, mode === "fetch");
      signal.throwIfAborted();
      if (limited.truncated && mode !== "fetch") {
        throw new Error("Resource exceeds the bounded read limit.");
      }
      body = limited.bytes;
    }
    const bounded = new Response(body === null ? null : new Uint8Array(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(bounded, "url", { value: response.url });
    return bounded;
  };
}

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
