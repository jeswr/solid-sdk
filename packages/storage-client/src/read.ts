// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Shared read semantics; each protocol supplies only its response shape.
import { parseRdf, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { StorageError } from "./errors.js";
import {
  boundedText,
  discard,
  failed,
  mediaTypeOf,
  type ReadShape,
  readResultFrom,
  scoped,
  send,
} from "./http.js";
import { listingTooLarge, throwIfAborted } from "./internal.js";
import type { AuthFetch, RdfReadResult, ReadResult, StorageClient } from "./types.js";

/** RFC 6838 type/subtype without parameters. */
export const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";
const RDF_READABLE: ReadonlySet<string> = new Set(SUPPORTED_RDF_MEDIA_TYPES);

/** Preserve protocol headers while allowing request-local transport markers. */
function requestHeaders(
  headers: Record<string, string>,
  extra?: RequestInit["headers"],
): Record<string, string> {
  const additional = new Headers(extra);
  for (const name of ["accept", "range", "if-none-match"]) additional.delete(name);
  return { ...Object.fromEntries(additional), ...headers };
}

export interface ReadExpectation {
  range: boolean;
  conditional: boolean;
  signal?: AbortSignal;
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
    if (response.status < 200 || response.status >= 400)
      await failed(method, url, response, expect.signal);
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
  maxBytes?: number,
  signal?: AbortSignal,
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
  const text =
    maxBytes === undefined
      ? await result.text()
      : await boundedText(result, maxBytes, listingTooLarge(result.url, maxBytes), signal);
  try {
    // fetch-rdf caps parsing at its own default budget, so a caller's larger byte cap must reach
    // it. boundedText already enforced the cap on raw bytes; decoding can turn each invalid byte
    // into U+FFFD (3 UTF-8 bytes), so fetch-rdf, which re-measures the decoded text, gets 3x room.
    const parseBytes =
      maxBytes === undefined ? undefined : Math.min(maxBytes * 3, Number.MAX_SAFE_INTEGER);
    const options = {
      baseIRI: result.url,
      ...(parseBytes === undefined ? {} : { maxBytes: parseBytes }),
      ...(signal === undefined ? {} : { signal }),
    };
    return { type, dataset: await parseRdf(text, result.contentType, options) };
  } catch (cause) {
    throwIfAborted("GET", result.url, signal);
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
    revalidate = false,
    extraHeaders?: RequestInit["headers"],
  ): Promise<ReadResult> {
    const target = scoped(root, "GET", url);
    const response = await send(
      fetch,
      "GET",
      target,
      requestHeaders(headers, extraHeaders),
      signal,
      undefined,
      revalidate,
    );
    const shape = await shapeOf("GET", target, response, {
      range,
      conditional: "If-None-Match" in headers,
      signal,
    });
    return readResultFrom(response, target, shape, signal);
  }
  const operations = {
    get,
    async head(url: string, opts: Parameters<StorageClient["head"]>[1] = {}) {
      const target = scoped(root, "HEAD", url);
      const response = await send(
        fetch,
        "HEAD",
        target,
        requestHeaders({ Accept: "*/*" }, opts.headers),
        opts.signal,
        undefined,
        opts.revalidate,
      );
      const shape = await shapeOf("HEAD", target, response, {
        range: false,
        conditional: false,
        signal: opts.signal,
      });
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
      return get(url, headers, opts.signal, opts.range !== undefined, false, opts.headers);
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
      const { type, dataset } = await rdfBody(result, "not-rdf", undefined, opts.signal);
      return { url: result.url, etag: result.etag, contentType: type, dataset };
    },
  };
  return operations;
}
