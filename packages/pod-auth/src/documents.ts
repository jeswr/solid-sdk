// AUTHORED-BY Codex GPT-6.1-Sol
import { secureUrl } from "./options.js";

const maxDocumentBytes = 1024 * 1024;

/** Honor cancellation even when an injected transport or response body ignores its signal. */
export async function abortable<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  if (signal === undefined) return await operation();
  let rejectCancellation!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const abort = () => rejectCancellation(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function readLimited(
  response: Response,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  try {
    if (Number(response.headers.get("content-length")) > maxDocumentBytes)
      throw new RangeError("The sign-in address returned more than 1 MiB");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await abortable(signal, () => reader.read());
      if (done) break;
      size += value.byteLength;
      if (size > maxDocumentBytes)
        throw new RangeError("The sign-in address returned more than 1 MiB");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    // A hostile stream may never finish cancellation. Do not wait for it.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Public, scheme-checked transport with a byte cap before either JSON or RDF parsing. */
export function boundedDocumentFetch(transport: typeof fetch, insecure: boolean): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, { ...init, credentials: "omit" });
    secureUrl(request.url, insecure, "sign-in address");
    return await abortable(request.signal, async () => {
      const response = await transport(request);
      try {
        // A transport that ignores abort may still return a body needing cleanup.
        request.signal.throwIfAborted();
        if (response.url !== "") secureUrl(response.url, insecure, "sign-in address");
        if (!response.ok || response.body === null) return response;
        const bytes = await readLimited(response, response.body, request.signal);
        const limited = new Response(bytes, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        // The RDF reader uses the final URL as the base after browser-managed redirects.
        Object.defineProperty(limited, "url", { value: response.url });
        return limited;
      } finally {
        // Discard errors, redirects and rejected URLs without waiting for hostile cancellation.
        if (!response.bodyUsed) void response.body?.cancel().catch(() => {});
      }
    });
  };
}
