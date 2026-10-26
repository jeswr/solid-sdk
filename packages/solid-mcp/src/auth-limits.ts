// AUTHORED-BY Codex GPT-6

const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;
const AUTH_TIMEOUT_MS = 30_000;

/** One deadline covers key creation, discovery, token bodies and nonce retries. */
export async function withAuthLimits<T>(
  acquire: (transport: typeof fetch) => Promise<T>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    void reader?.cancel().catch(() => {});
    rejectAbort(new Error("Authentication acquisition aborted"));
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  const transport: typeof fetch = async (input, init) => {
    controller.signal.throwIfAborted();
    const response = await fetchImpl(input, { ...init, signal: controller.signal });
    reader = response.body?.getReader();
    try {
      controller.signal.throwIfAborted();
      if (Number(response.headers.get("content-length")) > MAX_AUTH_RESPONSE_BYTES)
        throw new Error("Authentication response exceeds cap");
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_AUTH_RESPONSE_BYTES)
            throw new Error("Authentication response exceeds cap");
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new Response(response.body === null ? null : bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      // Do not let an uncooperative source's cancellation stall acquisition.
      void reader?.cancel().catch(() => {});
      reader = undefined;
    }
  };
  try {
    return await Promise.race([aborted, acquire(transport)]);
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
