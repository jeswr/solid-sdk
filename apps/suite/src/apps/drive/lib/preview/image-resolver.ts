// AUTHORED-BY Codex GPT-6.1-Sol
import type { ImageResolver } from "@jeswr/suite-ui";

/** Read a body into a Blob, refusing more than `maxBytes` (declared or streamed). */
async function boundedBlob(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Blob | undefined> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const type = response.headers.get("content-type") ?? "";
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes || signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(parts as BlobPart[], { type });
}

/**
 * TypedView aborts on replacement/unmount, releasing the URL owned by that read. `maxBytes`
 * caps what a document outside the user's storage may make the browser read; own-storage
 * callers leave it unset.
 */
export function createPreviewImageResolver(
  fetch: typeof globalThis.fetch,
  options: { maxBytes?: number } = {},
): ImageResolver {
  return async (url, signal) => {
    if (signal.aborted) return undefined;
    const response = await fetch(url, { signal });
    if (!response.ok || signal.aborted) return undefined;
    const blob =
      options.maxBytes === undefined
        ? await response.blob()
        : await boundedBlob(response, options.maxBytes, signal);
    // An injected transport may finish even after cancellation.
    if (!blob || signal.aborted) return undefined;
    const objectUrl = URL.createObjectURL(blob);
    signal.addEventListener("abort", () => URL.revokeObjectURL(objectUrl), { once: true });
    return objectUrl;
  };
}
