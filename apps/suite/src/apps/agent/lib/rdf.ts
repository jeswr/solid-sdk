// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
const MAX_BYTES = 1024 * 1024;

const RDF_TYPES = ["text/turtle", "application/trig"];
/** Status lists may also be stored as JSON-LD; their parser checks the structure strictly. */
export const STATUS_LIST_TYPES = [
  ...RDF_TYPES,
  "application/vc+ld+json",
  "application/ld+json",
  "application/json",
];

/** One bound and format policy for records, listings, and discovery documents. */
export async function readRdfDocument(response: Response, allowed: readonly string[] = RDF_TYPES) {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!contentType || !allowed.includes(contentType)) {
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
