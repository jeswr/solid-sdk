// AUTHORED-BY Codex GPT-6.1-Sol
// Shared read semantics; each protocol supplies only its response shape.
import { parseRdf, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { StorageError } from "./errors.js";
import {
  discard,
  failed,
  mediaTypeOf,
  type ReadShape,
  readResultFrom,
  scoped,
  send,
} from "./http.js";
import type { AuthFetch, RdfReadResult, ReadResult, StorageClient } from "./types.js";

/** RFC 6838 type/subtype without parameters. */
export const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";
const RDF_READABLE: ReadonlySet<string> = new Set(SUPPORTED_RDF_MEDIA_TYPES);

export interface ReadExpectation {
  range: boolean;
  conditional: boolean;
}
export type ShapeOf = (
  method: string,
  url: string,
  response: Response,
  expect: ReadExpectation,
) => Promise<ReadShape>;

/** Only 200, requested 206 and conditional 304 are read results. */
export async function acceptReadStatus(
  method: string,
  url: string,
  response: Response,
  expect: ReadExpectation,
): Promise<void> {
  const expected =
    response.status === 200 ||
    (response.status === 206 && expect.range) ||
    (response.status === 304 && expect.conditional);
  if (!expected) {
    if (response.status < 200 || response.status >= 400) await failed(method, url, response);
    // Any other success or redirect (204, unsolicited 206/304, 3xx) is not a read result.
    discard(response.body);
    throw new StorageError("invalid-response", {
      method,
      url,
      status: response.status,
      message: `${method} ${url} answered an unexpected ${response.status}`,
    });
  }
}

/** Parse an RDF body, mapping a non-RDF or unparsable body to `code`. */
export async function rdfBody(
  result: ReadResult,
  code: "not-rdf" | "invalid-response",
): Promise<{ type: string; dataset: Awaited<ReturnType<typeof parseRdf>> }> {
  const type = mediaTypeOf(result.contentType) ?? "";
  if (!RDF_READABLE.has(type)) {
    discard(result.body);
    throw new StorageError(code, {
      method: "GET",
      url: result.url,
      message: `${result.url} is ${result.contentType ?? "untyped"}, not RDF`,
    });
  }
  // Body transport failures surface as `network` (from bytes()), not as a parse error.
  const text = await result.text();
  try {
    return { type, dataset: await parseRdf(text, result.contentType, { baseIRI: result.url }) };
  } catch (cause) {
    throw new StorageError(code, {
      method: "GET",
      url: result.url,
      cause,
      message: `${result.url} is not valid ${type}`,
    });
  }
}

/** Scope, request headers, body mapping and conditional RDF reads shared by both protocols. */
export function createReadOperations(fetch: AuthFetch, root: string, shapeOf: ShapeOf) {
  async function get(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
    range = false,
  ): Promise<ReadResult> {
    const target = scoped(root, "GET", url);
    const response = await send(fetch, "GET", target, headers, signal);
    const shape = await shapeOf("GET", target, response, {
      range,
      conditional: "If-None-Match" in headers,
    });
    return readResultFrom(response, target, shape, signal);
  }
  const operations = {
    get,
    async head(url: string, opts: { signal?: AbortSignal } = {}) {
      const target = scoped(root, "HEAD", url);
      const response = await send(fetch, "HEAD", target, { Accept: "*/*" }, opts.signal);
      const shape = await shapeOf("HEAD", target, response, { range: false, conditional: false });
      return readResultFrom(response, target, shape, opts.signal);
    },
    async read(url: string, opts: Parameters<StorageClient["read"]>[1] = {}) {
      const headers: Record<string, string> = { Accept: opts.accept ?? "*/*" };
      if (opts.ifNoneMatch !== undefined) headers["If-None-Match"] = opts.ifNoneMatch;
      if (opts.range) {
        const { start, end } = opts.range;
        if (
          !Number.isSafeInteger(start) ||
          start < 0 ||
          (end !== undefined && (!Number.isSafeInteger(end) || end < start))
        ) {
          throw new RangeError("range must have 0 <= start <= end (safe integers)");
        }
        headers.Range = `bytes=${start}-${end ?? ""}`;
      }
      return get(url, headers, opts.signal, opts.range !== undefined);
    },

    async readRdf(
      url: string,
      opts: Parameters<StorageClient["readRdf"]>[1] = {},
    ): Promise<RdfReadResult> {
      const headers: Record<string, string> = { Accept: RDF_ACCEPT };
      if (opts.ifNoneMatch !== undefined) headers["If-None-Match"] = opts.ifNoneMatch;
      const result = await get(url, headers, opts.signal);
      if (result.status === 304) {
        return {
          url: result.url,
          etag: result.etag,
          contentType: mediaTypeOf(result.contentType) ?? "",
          dataset: new Store(),
          notModified: true,
        };
      }
      const { type, dataset } = await rdfBody(result, "not-rdf");
      return { url: result.url, etag: result.etag, contentType: type, dataset };
    },
  };
  return operations;
}
