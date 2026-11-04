// AUTHORED-BY Codex GPT-6.1-Sol
const MAX_BYTES = 1024 * 1024;

/** One bound and format policy for records, listings, and discovery documents. */
export async function readRdfDocument(response: Response) {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "text/turtle" && contentType !== "application/trig") {
    await response.body?.cancel();
    throw new Error("Unsupported agent record format");
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Record exceeds 1 MiB");
  }
  let text = "";
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BYTES) throw new Error("Record exceeds 1 MiB");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
    }
  }
  return { text, contentType, etag: response.headers.get("etag") };
}
