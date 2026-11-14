// AUTHORED-BY Codex GPT-6.1-Sol
/** Verification evidence has its own bound, independent of stored profiler samples. */
export const VERIFICATION_EVIDENCE_LIMIT = 8 * 1024 * 1024;

/** Fully consume a response or fail; a partial body is never verification evidence. */
export async function readVerificationBody(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  const length = response.headers.get("content-length");
  const expected = length !== null && /^\d+$/.test(length) ? Number(length) : undefined;
  if (expected !== undefined && expected > VERIFICATION_EVIDENCE_LIMIT) {
    await response.body?.cancel();
    throw new Error("verification evidence byte limit exceeded");
  }
  if (!response.body) {
    if (expected) throw new Error("verification evidence ended early");
    return "";
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error("verification evidence deadline exceeded");
      if (done) break;
      size += value.byteLength;
      if (size > VERIFICATION_EVIDENCE_LIMIT)
        throw new Error("verification evidence byte limit exceeded");
      chunks.push(value);
    }
    // Fetch exposes decoded bytes. Content-Length is comparable only without compression.
    if (!response.headers.has("content-encoding") && expected !== undefined && size !== expected)
      throw new Error("verification evidence ended early");
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
