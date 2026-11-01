// AUTHORED-BY Codex GPT-6.1-Sol
import {
  bufferBody,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_JSON_DEPTH,
  jsonDepthScanner,
  limit,
  parseLimit,
  snapshotJson,
} from "./budgets.js";
import { cancelResponseBody } from "./cancel-body.js";
import { RdfFetchError } from "./errors.js";
import { abortable, abortError, checkAbort, isAbortError } from "./operation.js";
import { redactUrl } from "./redact.js";
import type { DocumentLoader, ParseRdfOptions } from "./types.js";

/** Default JSON-LD policy: inline contexts work; remote contexts require opt-in. */
export const refusingDocumentLoader: DocumentLoader = {
  async load(url) {
    throw new RdfFetchError(`Remote JSON-LD context refused: ${redactUrl(url)}.`, { url });
  },
};

/**
 * Load allowlisted JSON-LD contexts exclusively through the supplied transport.
 * Redirects are refused so an allowed URL cannot redirect outside the allowlist.
 * Calls sharing an operation signal coalesce by URL while in flight.
 */
export function createFetchDocumentLoader(
  fetchImpl: typeof fetch,
  options: {
    allow: (url: string) => boolean;
    /** Additional cancellation, combined with the parse signal. */
    signal?: AbortSignal;
    /** Per-context deadline in milliseconds, including body reading. */
    timeoutMs?: number;
    /** Per-context response byte limit. Default: 16 MiB. */
    maxBytes?: number;
  },
): DocumentLoader {
  const loaderMaxBytes = limit(options.maxBytes, DEFAULT_MAX_BYTES, "maxBytes");
  const timeoutMs =
    options.timeoutMs === undefined ? undefined : limit(options.timeoutMs, 0, "timeoutMs");
  const independent = new Map<string, ReturnType<DocumentLoader["load"]>>();
  const operations = new WeakMap<AbortSignal, typeof independent>();
  return {
    load(url, request) {
      const operationSignal = request?.signal;
      let pending = operationSignal ? operations.get(operationSignal) : independent;
      if (!pending) {
        pending = new Map();
        if (operationSignal) operations.set(operationSignal, pending);
      }
      const existing = pending.get(url);
      if (existing) return existing;
      const result = load(url, request).finally(() => pending.delete(url));
      pending.set(url, result);
      return result;
    },
  };

  async function load(url: string, request?: Parameters<DocumentLoader["load"]>[1]) {
    const controller = new AbortController();
    const signals = [options.signal, request?.signal].filter((signal) => signal !== undefined);
    const onAbort = () => controller.abort();
    for (const signal of signals) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) controller.abort();
    }
    const timeout = timeoutMs === undefined ? undefined : setTimeout(onAbort, timeoutMs);
    const signal = controller.signal;
    let response: Response | undefined;
    try {
      checkAbort(signal);
      if (!options.allow(url)) {
        throw new RdfFetchError(`Remote JSON-LD context refused: ${redactUrl(url)}.`, { url });
      }
      const maxBytes = Math.min(
        loaderMaxBytes,
        limit(request?.maxBytes, loaderMaxBytes, "maxBytes"),
      );
      const maxJsonDepth = limit(request?.maxJsonDepth, DEFAULT_MAX_JSON_DEPTH, "maxJsonDepth");
      const fetched = await abortable<Response>(
        fetchImpl(url, {
          headers: new Headers({ accept: "application/ld+json" }),
          redirect: "error",
          signal,
        }).then((result) => {
          response = result;
          if (signal.aborted) {
            void cancelResponseBody(result);
            throw abortError(signal);
          }
          return result;
        }),
        signal,
      );
      response = fetched;
      if (!fetched.ok) {
        throw new RdfFetchError(
          `HTTP ${fetched.status} loading JSON-LD context ${redactUrl(url)}.`,
          {
            status: fetched.status,
            url,
          },
        );
      }
      const text = fetched.body
        ? await bufferBody(fetched.body, maxBytes, signal, jsonDepthScanner(maxJsonDepth))
        : "";
      checkAbort(signal);
      return JSON.parse(text);
    } catch (cause) {
      if (response) void cancelResponseBody(response);
      if (signal.aborted || isAbortError(cause)) throw abortError(signal);
      if (cause instanceof RdfFetchError) throw cause;
      throw new RdfFetchError(`Failed to load JSON-LD context ${redactUrl(url)}.`, { cause, url });
    } finally {
      clearTimeout(timeout);
      for (const signal of signals) signal.removeEventListener("abort", onAbort);
    }
  }
}

/** Each parse owns its cache, total request count and FIFO concurrency queue. */
export function parseDocumentLoader(
  options: ParseRdfOptions,
  signal: AbortSignal,
  fail: (error: unknown) => void,
): DocumentLoader {
  const loader = options.documentLoader ?? refusingDocumentLoader;
  const maxRequests = limit(options.maxContextRequests, 32, "maxContextRequests");
  const concurrency = limit(options.maxContextConcurrency, 4, "maxContextConcurrency", 1);
  const maxJsonDepth = limit(options.maxJsonDepth, DEFAULT_MAX_JSON_DEPTH, "maxJsonDepth");
  const pending = new Map<string, ReturnType<DocumentLoader["load"]>>();
  const waiting: (() => void)[] = [];
  let requests = 0;
  let active = 0;
  return {
    load(url) {
      const existing = pending.get(url);
      if (existing) return existing;
      const result = load(url)
        .catch((cause: unknown) => {
          const error = isAbortError(cause)
            ? abortError(signal)
            : cause instanceof Error
              ? cause
              : new RdfFetchError(`Failed to load JSON-LD context ${redactUrl(url)}.`, {
                  cause,
                  url,
                });
          fail(error);
          throw error;
        })
        .finally(() => pending.delete(url));
      pending.set(url, result);
      return result;
    },
  };

  async function load(url: string) {
    checkAbort(signal);
    if (++requests > maxRequests) throw parseLimit("maxContextRequests");
    // Reserve a slot before yielding; releases hand the slot directly to the next waiter.
    if (active < concurrency) active++;
    else await abortable(new Promise<void>((resolve) => waiting.push(resolve)), signal);
    try {
      checkAbort(signal);
      const document = await abortable(
        loader.load(url, { signal, maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES, maxJsonDepth }),
        signal,
      );
      return snapshotJson(document, maxJsonDepth) as typeof document;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
}
