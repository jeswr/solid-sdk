// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
/** Internal byte limits and safe parsing for pod content. */
export const MAX_CONTENT_BYTES = 1024 * 1024;

export function mediaType(header: string | null): string {
  return header?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
}

/** Retain at most the cap, probing for overflow even without Content-Length. */
export async function limitedBody(
  response: Response,
  signal?: AbortSignal,
  // Preserve the overflow probe when passing a bounded prefix through PodPort's
  // byte-array seam, so the tool can detect truncation after read decorators run.
  retainOverflowByte = false,
): Promise<{
  bytes: Uint8Array;
  truncated: boolean;
}> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal?.aborted) abort();
    signal?.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { bytes: Buffer.concat(chunks, size), truncated: false };
      const remaining = MAX_CONTENT_BYTES - size;
      // Copy only the retained prefix; do not retain a potentially huge chunk.
      const retained = remaining + (retainOverflowByte ? 1 : 0);
      chunks.push(value.slice(0, retained));
      size += Math.min(value.byteLength, retained);
      if (value.byteLength > remaining) {
        void reader.cancel().catch(() => {});
        return { bytes: Buffer.concat(chunks, size), truncated: true };
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Decode a capped UTF-8 prefix without introducing a partial final code point. */
export function decodePrefix(bytes: Uint8Array, truncated: boolean): string {
  return new TextDecoder().decode(bytes, { stream: truncated });
}

/** Normalize JSON-LD for parsing with the refusing document loader. */
export function normalizeLocalJsonLd(text: string, validate: (document: unknown) => void): string {
  const document: unknown = JSON.parse(text);
  // Validate before stringify: deeply nested JSON can exhaust its call stack.
  validate(document);
  // Resolve duplicate keys before the streaming parser sees them. Contexts and
  // @import inside JSON literals are opaque data; the parser's refusing loader
  // rejects actual remote contexts without inspecting literal contents.
  return JSON.stringify(document, (_key, value: unknown) => {
    // JSON.parse accepts numeric overflow as Infinity. Refuse it before
    // stringify substitutes null, including inside opaque JSON literals.
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Non-finite JSON numbers are unsupported.");
    }
    return value;
  });
}

export function resourceTitle(url: string): string {
  const parsed = new URL(url);
  const segment = parsed.pathname.replace(/\/$/, "").split("/").pop() || parsed.host;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
