// AUTHORED-BY Codex (GPT-6.1 Sol)
import { isHttpIri } from "@jeswr/model-runtime";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_LIMIT = 10 * 1024 * 1024;
/** Fetch a raster slide image through the session's bounded transport, refusing redirects. */
export async function readSlideImage(
  fetch: typeof globalThis.fetch,
  url: string,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!isHttpIri(url)) throw new TypeError("Invalid image URL");
  const response = await fetch(url, { redirect: "error", signal });
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!response.ok || !IMAGE_TYPES.has(type)) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Image unavailable");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        signal?.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > IMAGE_LIMIT) {
          void reader.cancel().catch(() => {});
          throw new RangeError("Image exceeds 10 MB");
        }
        chunks.push(new Uint8Array(part.value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  return new Blob(chunks, { type });
}
