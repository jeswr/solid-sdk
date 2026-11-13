// AUTHORED-BY Codex GPT-6.1-Sol
/** Distinguish the byte cap from a transport or abort reason that is itself a RangeError. */
export class ResponseBodyLimitError extends RangeError {
  constructor() {
    super("Response body exceeds the byte limit.");
    this.name = "ResponseBodyLimitError";
  }
}

/** Read strict UTF-8 within a byte budget, cancelling the body on completion or failure. */
export async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError("Expected a non-negative safe integer byte limit");
  const reader = response.body?.getReader();
  // Do not let a failed or stalled underlying cancellation hide the original outcome.
  const cancel = () => {
    void reader?.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new ResponseBodyLimitError();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new ResponseBodyLimitError();
        text += decoder.decode(value, { stream: true });
      }
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader?.releaseLock();
  }
}
