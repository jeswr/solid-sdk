// AUTHORED-BY Codex GPT-6
import { extractMediaType, parseRdf, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { requireRepresentation } from "./rdf.js";

/** Validate before creating a placeholder or overwriting any destination content. */
export async function readResourceBytes(response: Response, url: string): Promise<Uint8Array> {
  requireRepresentation(response);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    throw new TypeError(`Incomplete resource body at ${url}: response stream failed`, { cause });
  }
  const length = response.headers.get("content-length");
  const encoding = response.headers.get("content-encoding");
  // Fetch decodes Content-Encoding while retaining the encoded Content-Length.
  if (length !== null && (!encoding || encoding.toLowerCase() === "identity")) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
      throw new TypeError(`Invalid Content-Length at ${url}`);
    if (bytes.byteLength !== Number(length))
      throw new TypeError(
        `Incomplete resource body at ${url}: Content-Length is ${length} bytes, received ${bytes.byteLength}`,
      );
  }
  const contentType = response.headers.get("content-type");
  if (SUPPORTED_RDF_MEDIA_TYPES.some((type) => type === extractMediaType(contentType))) {
    try {
      // A lying short Content-Length can exactly match the bytes Fetch exposes.
      // CSS 7.2's in-memory PATCH path does this for non-ASCII Turtle. Parse even
      // when IRI rewriting is disabled, and reject partial UTF-8 sequences too.
      await parseRdf(new TextDecoder("utf-8", { fatal: true }).decode(bytes), contentType, {
        baseIRI: url,
      });
    } catch (cause) {
      throw new TypeError(`Invalid or truncated RDF body at ${url}; refusing to copy`, { cause });
    }
  }
  return bytes;
}
