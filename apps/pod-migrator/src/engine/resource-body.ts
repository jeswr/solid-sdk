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
  http?: Pick<PodHttp, "get">;
  signal?: AbortSignal;
  semantic?: boolean;
  /** Network data used to decide access: unavailable completeness evidence refuses the read. */
  securityRelevant?: boolean;
  /** Retained upload bytes: exact equality establishes target completeness. */
  expected?: Uint8Array;
  /** False only for explicit RDF rewriting. */
  verbatim?: boolean;
  /**
   * Accept a verbatim copy whose completeness rests on graph isomorphism alone. Called with
   * the reason; without it such a read is refused.
   */
  onGraphProofOnly?: (reason: string) => void;
}

/** JSON-LD frames itself; other conversions must omit the possibly character-counted length. */
async function independentGraph(
  http: Pick<PodHttp, "get">,
  url: string,
  accept: string,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<typeof parseRdf>>> {
  const response = await http.get(url, { accept, signal });
  if (
    extractMediaType(response.headers.get("content-type")) !== accept ||
    (accept !== "application/ld+json" && response.headers.has("content-length"))
  ) {
    await response.body?.cancel();
    throw new Error("Server did not supply an independently framed serialization");
  }
  // Strict UTF-8, full JSON syntax and the default refusing context loader are shared
  // with original reads. No transport is passed, so conversion cannot negotiate again.
  return (await readBody(response, url, { semantic: true })).dataset as Awaited<
    ReturnType<typeof parseRdf>
  >;
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
  let length = response.headers.get("content-length");
  const encoding = response.headers.get("content-encoding");
  const identity = !encoding || encoding.toLowerCase() === "identity";
  // Fetch decodes Content-Encoding while retaining the encoded Content-Length.
  if (length !== null && identity) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
      throw new ResourceReadError(url, `Invalid Content-Length at ${url}`);
    // CORS can hide compression, which can expand small bodies. A short decoded
    // CORS body then has no reliable length; a longer body remains acceptable.
    if (bytes.byteLength < Number(length)) {
      if (response.type === "cors" && !encoding) length = null;
      else
        throw new ResourceReadError(
          url,
          `Incomplete resource body at ${url}: Content-Length is ${length} bytes, received ${bytes.byteLength}`,
        );
    }
  }
  const expected = options.expected;
  if (
    expected &&
    (bytes.length !== expected.length || bytes.some((value, i) => value !== expected[i]))
  )
    throw new ResourceReadError(url, "Content verification failed");
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
    // as a byte count even when the prefix is valid RDF. Length-free data also
    // checks any available conversion; security decisions require that evidence.
    // A complete JSON document already establishes its syntactic boundary.
    if (
      type !== "application/ld+json" &&
      !expected &&
      (options.securityRelevant ||
        length === null ||
        (identity && bytes.byteLength === Number(length))) &&
      bytes.some((b) => b > 127)
    ) {
      let failClosed = options.securityRelevant || length !== null;
      try {
        if (!options.http) throw new Error("No independent representation transport");
        let other: Awaited<ReturnType<typeof parseRdf>>;
        try {
          other = await independentGraph(options.http, url, "application/ld+json", options.signal);
        } catch {
          const accept =
            type === "application/n-quads" ? "application/trig" : "application/n-quads";
          other = await independentGraph(options.http, url, accept, options.signal);
        }
        // A valid conversion makes graph disagreement evidence of missing data.
        // Compare outside the JSON-LD fallback: disagreement must never try another graph.
        failClosed = true;
        if (!isomorphic(dataset as NonNullable<typeof dataset>, other))
          throw new Error("Independent RDF graphs differ");
        graphProofOnly = true;
      } catch (cause) {
        if (failClosed)
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
