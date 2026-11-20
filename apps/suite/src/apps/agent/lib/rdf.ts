// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { ResponseBodyLimitError, readBoundedText } from "@jeswr/guarded-fetch";

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
  let text: string;
  try {
    text = await readBoundedText(response, MAX_BYTES);
  } catch (error) {
    if (error instanceof ResponseBodyLimitError) throw new Error("Record exceeds 1 MiB");
    throw error;
  }
  return { text, contentType, etag: response.headers.get("etag") };
}
