// AUTHORED-BY Codex GPT-6.1-Sol
import { abortableFetch } from "../abort.js";
import { MAX_JSON_BYTES, ResponseTooLargeError, type RunBudget } from "../budget.js";

/** Bound source bodies even when a provider adapter uses Response.json() directly. */
export function syncSourceFetch(
  source: typeof fetch,
  id: string,
  budget: RunBudget,
  signal?: AbortSignal,
): typeof fetch {
  const transport = signal ? abortableFetch(source, signal) : source;
  return async (input, init) => {
    signal?.throwIfAborted();
    budget.request();
    const response = await transport(input, init);
    const url = response.url || "urn:solid:connector:source";
    if (Number(response.headers.get("content-length")) > MAX_JSON_BYTES) {
      await response.body?.cancel();
      throw new ResponseTooLargeError(id, url);
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    let bytes = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            signal?.throwIfAborted();
            const result = await reader.read();
            signal?.throwIfAborted();
            if (result.done) {
              controller.close();
              return;
            }
            bytes += result.value.byteLength;
            budget.bytes(result.value.byteLength);
            if (bytes > MAX_JSON_BYTES) throw new ResponseTooLargeError(id, url);
            controller.enqueue(result.value);
          } catch (error) {
            try {
              await reader.cancel(error);
            } catch {
              /* Preserve the budget/abort error. */
            }
            controller.error(error);
          }
        },
        cancel: (reason) => reader.cancel(reason),
      },
      { highWaterMark: 0 },
    );
    const bounded = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(bounded, "url", { value: response.url });
    return bounded;
  };
}
