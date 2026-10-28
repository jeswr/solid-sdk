// AUTHORED-BY Codex GPT-6

// Match @jeswr/guarded-fetch's profile/resource defaults. Its body and deadline
// helpers are private; the public wrapper would follow redirects independently
// of the anonymous transport's same-origin policy and Request.redirect mode.
const MAX_PROFILE_BYTES = 1024 * 1024;
const PROFILE_TIMEOUT_MS = 10_000;

/** One budget spans the initial request, DNS, all hops and streamed body reads. */
export async function withProfileLimits(
  request: Request,
  transport: (request: Request) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", onCallerAbort, { once: true });
  if (request.signal.aborted) onCallerAbort();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Anonymous profile deadline exceeded", "TimeoutError")),
    PROFILE_TIMEOUT_MS,
  );
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    void reader?.cancel(controller.signal.reason).catch(() => {});
    rejectAbort(controller.signal.reason);
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  try {
    return await Promise.race([
      aborted,
      (async () => {
        controller.signal.throwIfAborted();
        const response = await transport(new Request(request, { signal: controller.signal }));
        reader = response.body?.getReader();
        if (controller.signal.aborted) void reader?.cancel().catch(() => {});
        controller.signal.throwIfAborted();
        const declared = Number(response.headers.get("content-length"));
        if (declared > MAX_PROFILE_BYTES) throw new Error("Anonymous profile body exceeds cap");
        const chunks: Uint8Array[] = [];
        let total = 0;
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            controller.signal.throwIfAborted();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_PROFILE_BYTES) throw new Error("Anonymous profile body exceeds cap");
            chunks.push(value);
          }
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const result = new Response(response.body === null ? null : bytes, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        Object.defineProperty(result, "url", { value: response.url || request.url });
        return result;
      })(),
    ]);
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onCallerAbort);
    controller.signal.removeEventListener("abort", onAbort);
    // Cancellation need not settle for an uncooperative stream to release the budget.
    void reader?.cancel().catch(() => {});
  }
}
