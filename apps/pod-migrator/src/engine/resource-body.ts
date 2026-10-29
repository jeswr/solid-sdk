// AUTHORED-BY Codex GPT-6
import { extractMediaType, parseRdf, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { isomorphic } from "./isomorphism.js";
import type { PodHttp } from "./types.js";

/** Retain the affected resource through planning, preflight and verification. */
export class ResourceReadError extends TypeError {
  constructor(
    public resourceUrl: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}
interface ReadOptions {
  http?: PodHttp;
  signal?: AbortSignal;
  semantic?: boolean;
  accessDocument?: boolean;
  /** False only for explicit RDF rewriting or comparison with known complete bytes. */
  verbatim?: boolean;
  /**
   * Accept a verbatim copy whose completeness rests on graph isomorphism alone. Called with
   * the reason; without it such a read is refused.
   */
  onGraphProofOnly?: (reason: string) => void;
}

/** All network RDF readers share byte validation, strict decoding and completeness proof. */
export async function readBody(response: Response, url: string, options: ReadOptions = {}) {
  if (response.status !== 200)
    throw new ResourceReadError(url, `Expected a complete representation (${response.status})`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    throw new ResourceReadError(
      url,
      `Incomplete resource body at ${url}: response stream failed`,
      cause,
    );
  }
  const length = response.headers.get("content-length");
  const encoding = response.headers.get("content-encoding");
  const identity = !encoding || encoding.toLowerCase() === "identity";
  // Fetch decodes Content-Encoding while retaining the encoded Content-Length.
  if (length !== null && identity) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
      throw new ResourceReadError(url, `Invalid Content-Length at ${url}`);
    // CORS can expose Content-Length while hiding Content-Encoding. A decoded
    // body longer than the encoded length is not evidence of truncation.
    if (bytes.byteLength < Number(length))
      throw new ResourceReadError(
        url,
        `Incomplete resource body at ${url}: Content-Length is ${length} bytes, received ${bytes.byteLength}`,
      );
  }
  const contentType = response.headers.get("content-type");
  const type = extractMediaType(contentType);
  let dataset: Awaited<ReturnType<typeof parseRdf>> | undefined;
  let graphProofOnly = false;
  if (options.semantic || SUPPORTED_RDF_MEDIA_TYPES.some((supported) => supported === type)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      // JSON is self-delimiting: validate the entire document without expanding contexts
      // for a verbatim copy. Semantic reads/rewrites still use the refusing RDF loader.
      if (type === "application/ld+json") JSON.parse(text);
      if (type !== "application/ld+json" || options.semantic)
        dataset = await parseRdf(text, contentType, { baseIRI: url });
    } catch (cause) {
      throw new ResourceReadError(
        url,
        `Invalid or truncated RDF body at ${url}; refusing to copy`,
        cause,
      );
    }
    // With ambiguous framing, a non-ASCII string's character count can masquerade
    // as a byte count even when the prefix is valid RDF. Access documents also
    // require conversion evidence when the first response has no visible length.
    // A complete JSON document already establishes its syntactic boundary.
    if (
      type !== "application/ld+json" &&
      (options.accessDocument ||
        (length !== null && identity && bytes.byteLength === Number(length))) &&
      bytes.some((b) => b > 127)
    ) {
      try {
        if (!options.http) throw new Error("No independent representation transport");
        const accept = type === "application/n-quads" ? "application/trig" : "application/n-quads";
        const independent = await options.http.get(url, { accept, signal: options.signal });
        if (
          extractMediaType(independent.headers.get("content-type")) !== accept ||
          independent.headers.has("content-length")
        ) {
          await independent.body?.cancel();
          throw new Error("Server did not supply an independently framed serialization");
        }
        const other = await readBody(independent, url, { semantic: true });
        if (
          !isomorphic(
            dataset as NonNullable<typeof dataset>,
            other.dataset as NonNullable<typeof dataset>,
          )
        )
          throw new Error("Independent RDF graphs differ");
        graphProofOnly = true;
      } catch (cause) {
        throw new ResourceReadError(
          url,
          `RDF completeness cannot be established at ${url}: independent representation unavailable or graph mismatch`,
          cause,
        );
      }
    }
  }
  return { bytes, dataset, graphProofOnly };
}

/** Validate before creating any destination state, preserving the original bytes. */
export async function readResourceBytes(
  response: Response,
  url: string,
  options: ReadOptions = {},
): Promise<Uint8Array> {
  const body = await readBody(response, url, options);
  if (body.graphProofOnly && options.verbatim !== false) {
    const reason = `Byte-verbatim completeness cannot be established at ${url}: graph equality cannot prove original bytes, including duplicate triples`;
    if (!options.onGraphProofOnly) throw new ResourceReadError(url, reason);
    options.onGraphProofOnly(reason);
  }
  return body.bytes;
}
